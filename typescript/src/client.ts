/**
 * Cliente HTTP de la API de Pimia.
 *
 * Lo que resuelve por ti, que es justo donde se equivoca una integración
 * escrita a mano:
 *
 *  - **rotación de refresh**: refresca al detectar caducidad o un 401, y
 *    persiste el TokenSet nuevo en tu TokenStore antes de reintentar;
 *  - **un solo refresh a la vez** dentro del proceso: dos refrescos paralelos
 *    con el mismo token son un reuse para el servidor, y un reuse revoca el
 *    grant entero. Entre procesos, esto no basta: usa un store compartido con
 *    su propio candado;
 *  - **429**: respeta `Retry-After` y reintenta con espera acotada;
 *  - **errores tipados**: MissingScopeError trae el scope exacto que falta.
 */

import type { components, operations } from './api.js'
import {
  NotAuthenticatedError,
  OAuthError,
  PimiaApiError,
  RateLimitError,
  UnauthorizedError,
} from './errors.js'
import { OAuth, type OAuthConfig } from './oauth.js'
import { BorrowedTokenStore, isExpired, type TokenSet, type TokenStore } from './tokens.js'

type Schemas = components['schemas']

/** Cliente tal y como lo devuelve la API. */
export type CustomerResource = Schemas['CustomerResource']
/** Factura tal y como la devuelve la API. */
export type InvoiceResource = Schemas['InvoiceResource']
/** Presupuesto tal y como lo devuelve la API. */
export type EstimateResource = Schemas['EstimateResource']
/** Contrato de servicio tal y como lo devuelve la API. */
export type ContractResource = Schemas['ContractResource']
/** Almacén tal y como lo devuelve la API. */
export type WarehouseResource = Schemas['WarehouseResource']
/** El saldo de un artículo EN un almacén. */
export type ItemWarehouseStockResource = Schemas['ItemWarehouseStockResource']
/** Un recuento de inventario tal y como lo devuelve la API. */
export type StockCountResource = Schemas['StockCountResource']

/** Cuerpo de alta/edición de cliente. Incluye `customFields`. */
export type CustomerRequest = Schemas['CustomerRequest']
/** Cuerpo de alta/edición de factura. Incluye `customFields`. */
export type InvoicesRequest = Schemas['InvoicesRequest']
/** Cuerpo de alta/edición de presupuesto. Incluye `customFields`. */
export type EstimatesRequest = Schemas['EstimatesRequest']
/**
 * Cuerpo de alta/edición de contrato. Sin `status` a propósito: el ciclo de
 * vida va por sus acciones (`activate`/`cancel`/`renew`), nunca por el PUT.
 */
export type ContractRequest = Schemas['ContractRequest']
/**
 * Cuerpo de alta/edición de almacén. `is_default` se manda como INTENCIÓN
 * («que este sea el de por defecto»): el servidor apaga el anterior en la
 * misma transacción, porque la empresa necesita exactamente uno.
 */
export type WarehouseRequest = Schemas['WarehouseRequest']
/**
 * Cuerpo del alta y del conteo de un recuento. ⚠️ En `lines`,
 * `counted_quantity: null` es «sin contar» y **no** es cero: las líneas en
 * null no emiten nada al confirmar.
 */
export type StockCountRequest = Schemas['StockCountRequest']

/**
 * Cuerpo del alta de una oportunidad: **a quién va dirigida**, y nada más.
 *
 * ⛔ La etapa, la probabilidad y el importe esperado son del CRM que llama —
 * Pimia no los guarda—, así que mandarlos es un 422. Y está bien que lo sea: el
 * día que los aceptara callando, habría dos sitios donde vive el embudo.
 */
export interface OpportunityRequest {
  name: string
  contact_name?: string | null
  email?: string | null
  phone?: string | null
}

/**
 * Una oportunidad recién creada.
 *
 * ⚠️ **No sale del spec**: `POST /opportunities` es más nueva que la última
 * sincronización del contrato (galeote/factSaas#805), así que el generador no
 * la conoce todavía. Lo único que este tipo promete es `id`, que es lo que hace
 * falta para colgarle presupuestos después; el resto llega y no se nombra.
 * Cuando la ruta entre en el spec, esto pasará a salir de `Ok<…>` como los
 * demás.
 */
export interface OpportunityResource {
  id: number
  [key: string]: unknown
}

/**
 * El cuerpo JSON de la respuesta de ÉXITO de una operación, sacado del OpenAPI.
 *
 * Atarlo al spec y no escribirlo a mano es lo que hace que un cambio de
 * contrato aparezca al regenerar los tipos en vez de en producción.
 *
 * ⚠️ **Mira el `201` además del `200`, y esa segunda rama no es un adorno.**
 * Desde factSaas#435 las altas publican `201` —lo pone Laravel solo, mirando
 * `wasRecentlyCreated`—, y este helper llevaba el `200` escrito a mano. Con una
 * sola rama, `customers.create` y `estimates.create` habrían resuelto a `never`
 * **sin un solo error de compilación**: el SDK habría seguido compilando y
 * publicándose, y quien lo usara se habría quedado sin tipo de respuesta sin
 * que nada lo avisara. Es la clase de fallo que no se ve hasta que alguien
 * pregunta por qué su editor no le autocompleta.
 *
 * El orden importa poco —una operación no publica los dos códigos con cuerpos
 * distintos— pero se prueba el `200` primero porque es el caso mayoritario.
 */
type Ok<O extends keyof operations> = operations[O] extends {
  responses: { 200: { content: { 'application/json': infer Body } } }
}
  ? Body
  : operations[O] extends {
        responses: { 201: { content: { 'application/json': infer Body } } }
      }
    ? Body
    : never

/**
 * El sobre `{ data: … }` de Laravel para las escrituras que el spec **no
 * tipa**.
 *
 * Hay 17 operaciones cuyo `200` sale del generador como objeto vacío, y entre
 * ellas están `POST /invoices`, `PUT /invoices/{id}`, `PUT /customers/{id}` y
 * `POST /estimates/{id}/convert-to-invoice`. Usar ahí el tipo generado sería
 * peor que no tipar: `Record<string, never>` afirma que la respuesta **no
 * tiene propiedades**, y el `data` real desaparecería del autocompletado.
 *
 * Así que el sobre se declara aquí y el recurso de dentro sí sale del spec.
 * Está verificado contra los controladores del core, no supuesto: los cuatro
 * devuelven `new XResource($modelo)` con el envoltorio `data` de Laravel
 * activo. La causa del hueco es del generador —un `@return JsonResponse`
 * heredado que le gana a la inferencia—, no del contrato; cuando se arregle
 * en el core, estos tipos pasarán a salir de `Ok<…>` como los demás.
 */
export interface ResourceEnvelope<T> {
  data: T
}

export interface PimiaClientOptions extends OAuthConfig {
  tokens: TokenStore
  /** Segundos de margen para refrescar antes de que caduque (default 60). */
  expirySkewSeconds?: number
  /** Reintentos ante 429 (default 2). */
  maxRateLimitRetries?: number
  /** Espera máxima por reintento de 429, en ms (default 30 000). */
  maxRetryDelayMs?: number
  /** Cabeceras añadidas a cada petición (p. ej. un User-Agent propio). */
  headers?: Record<string, string>
}

/**
 * Lo que hace falta para un cliente que **reenvía el token de otro**.
 *
 * Sin `clientId`, sin `clientSecret`, sin `redirectUri` y sin `tokens`: no hay
 * ceremonia OAuth que hacer ni nada tuyo que persistir, porque el grant no es
 * tuyo. Ver {@link PimiaClient.withBorrowedToken}.
 */
export interface BorrowedTokenOptions {
  /** Base del tenant, con o sin barra final: `https://acme.pimia.es`. */
  baseUrl: string
  /** El bearer que te llegó, tal cual. */
  accessToken: string
  fetch?: typeof globalThis.fetch
  /** Cabeceras fijas de cada llamada (p. ej. la `company` activa). */
  headers?: Record<string, string>
  /**
   * Reintentos ante 429 (default 2).
   *
   * ⚠️ Ponlo a **0** si atiendes una petición HTTP de un usuario que está
   * esperando: los reintentos ESPERAN, y esperar 30 s dentro de una petición
   * web es una petición colgada y un proceso ocupado.
   */
  maxRateLimitRetries?: number
  /** Espera máxima por reintento de 429, en ms (default 30 000). */
  maxRetryDelayMs?: number
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Query string. Los `undefined`/`null` se omiten; los arrays se repiten. */
  query?: Record<string, string | number | boolean | undefined | null | Array<string | number>>
  /**
   * El cuerpo de la petición.
   *
   * Por defecto se manda como **JSON**, que es lo que pide casi toda la API.
   *
   * Diez operaciones del contrato son `multipart/form-data` —el justificante
   * de un gasto, el documento de una factura recibida, importar un extracto
   * bancario, el membrete de una plantilla, el certificado de firma…—, y para
   * ésas se pasa un {@link FormData}: el cliente lo manda **tal cual** y **no
   * le pone `content-type`**, para que el runtime escriba el suyo con su
   * `boundary`. {@link toFormData} lo arma con las conversiones que el
   * servidor espera.
   *
   * También pasan sin tocar `Blob`, `URLSearchParams`, `ArrayBuffer` y las
   * vistas de `ArrayBuffer`.
   *
   * ⛔ Un `ReadableStream` **no**, y es a propósito: este cliente reintenta
   * ante un 401 (tras refrescar) y ante un 429, y un stream ya consumido no se
   * puede volver a mandar — el reintento fallaría con un error que no se
   * parece en nada a su causa. Los cinco de arriba se pueden releer.
   */
  body?: unknown
  /**
   * Cómo leer una respuesta **correcta**.
   *
   * `'json'` (el defecto) es lo de siempre. `'blob'` es para las dos
   * operaciones que devuelven un fichero (`application/octet-stream`):
   * descargar el membrete de una plantilla y el documento escaneado de una
   * factura recibida.
   *
   * ⚠️ Sin esto, un PDF se lee con `response.text()` y **se corrompe en
   * silencio**: el fichero «llega», pesa lo suyo y no se abre.
   *
   * Los errores se siguen leyendo como JSON aunque pidas `'blob'` — cuando la
   * API falla contesta su sobre de error, no el fichero.
   */
  responseType?: 'json' | 'blob'
  headers?: Record<string, string>
  signal?: AbortSignal
  /**
   * Clave de idempotencia para este `POST`. Manda una única por operación —un
   * UUID nuevo— y reúsala SOLO en los reintentos de esa misma operación:
   * Pimia ejecuta la escritura una vez y reproduce la respuesta original en
   * los reintentos. La misma clave con otro cuerpo responde 422.
   *
   * Para saber si lo que recibiste es un eco y no una escritura nueva, usa
   * {@link PimiaClient.requestWithMeta} y mira `meta.idempotentReplay`.
   */
  idempotencyKey?: string
}

/** Cabeceras de rate limit que devuelve la API en cada respuesta. */
export interface RateLimit {
  limit?: number
  remaining?: number
}

/**
 * Lo que la respuesta dice ADEMÁS del cuerpo.
 *
 * Va por petición y no como estado del cliente —al contrario que
 * {@link PimiaClient.rateLimit}— a propósito: `idempotentReplay` solo
 * significa algo referido a UNA llamada concreta, y justo se consulta cuando
 * hay reintentos, que es cuando puede haber varias en vuelo. Un campo
 * compartido en el cliente daría la respuesta de otra.
 */
export interface ResponseMeta {
  status: number
  /**
   * `true` si Pimia reprodujo la respuesta de una petición anterior con la
   * misma `Idempotency-Key` en vez de volver a escribir. Es la diferencia
   * entre «he creado la factura» y «ya estaba creada»: sin esto, un partner
   * no puede distinguirlas en sus propios registros.
   */
  idempotentReplay: boolean
  requestId?: string
  rateLimit: RateLimit
}

/** Cuerpo y metadatos de una misma respuesta. */
export interface ResponseWithMeta<T> {
  data: T
  meta: ResponseMeta
}

/** Lo que se puede afinar en una escritura (`post`/`put`/`patch`). */
export type WriteOptions = Pick<
  RequestOptions,
  'headers' | 'query' | 'signal' | 'idempotencyKey'
>

/**
 * Lo que se puede afinar en una lectura (`get`/`delete` y los atajos de
 * recurso).
 *
 * Sin `idempotencyKey`, que no significa nada en una lectura, y sin `query`,
 * que en `get()` ya es un parámetro propio.
 *
 * Existe sobre todo por `signal`: hasta la 0.4 los atajos de lectura no
 * aceptaban opciones, así que ponerle un timeout a un GET obligaba a bajar a
 * `request()` — o a quedarse sin él, que es lo que pasa de verdad. Un cliente
 * que sondea y se cuelga en una lectura deja de sondear sin dar un solo error.
 */
export type ReadOptions = Pick<RequestOptions, 'headers' | 'signal'>

export class PimiaClient {
  /**
   * La ceremonia OAuth, o `null` si este cliente no tiene grant propio
   * ({@link PimiaClient.withBorrowedToken}). Es `null` y no un objeto a medias
   * a propósito: un `OAuth` sin `clientId` compondría una URL de autorización
   * con `client_id=` vacío y el fallo aparecería en el navegador del usuario,
   * lejos de aquí.
   */
  readonly oauth: OAuth | null
  private readonly baseUrl: string
  private readonly doFetch: typeof globalThis.fetch
  private readonly store: TokenStore
  private readonly skew: number
  private readonly maxRateLimitRetries: number
  private readonly maxRetryDelayMs: number
  private readonly extraHeaders: Record<string, string>
  /** Refresco en vuelo: cualquier petición que llegue mientras tanto lo espera. */
  private refreshing: Promise<TokenSet> | null = null
  private lastRateLimit: RateLimit = {}

  constructor(options: PimiaClientOptions) {
    /* Sin `clientId` no hay a quién identificar ante el Authorization Server:
       este cliente no tiene grant propio y no puede tener ceremonia. */
    this.oauth = options.clientId ? new OAuth(options) : null
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.doFetch = options.fetch ?? globalThis.fetch
    this.store = options.tokens
    this.skew = options.expirySkewSeconds ?? 60
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 2
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000
    this.extraHeaders = options.headers ?? {}
  }

  /**
   * Un cliente que **reenvía el token de otro**, sin identidad propia.
   *
   * ── Cuándo es esto lo correcto ─────────────────────────────────────────────
   *
   * Cuando tu servicio se sienta DELANTE de un usuario que ya entró en Pimia:
   * el front te manda su `Authorization` y tú lo reenvías. No necesitas
   * `clientId`, ni `clientSecret`, ni `redirectUri`, ni un `TokenStore` —no hay
   * nada tuyo que guardar— y ganas la propiedad que hace esto seguro: **Pimia
   * sigue decidiendo los permisos**. Tu servicio no puede darle a nadie más de
   * lo que su token ya le daba, así que no hay una credencial de servicio que
   * auditar aparte.
   *
   * ```ts
   * const pimia = PimiaClient.withBorrowedToken({
   *   baseUrl: `https://${tenant}.pimia.es`,
   *   accessToken: bearerDeQuienLlama,
   *   // La empresa activa viaja en cabecera, como en todo el API. OMÍTELA
   *   // cuando no la sepas: `company:` vacía es una cabecera presente que no
   *   // casa con ninguna empresa.
   *   headers: empresa === null ? {} : { company: String(empresa) },
   *   // Atiendes una petición web: no esperes dentro de ella.
   *   maxRateLimitRetries: 0,
   * })
   *
   * await pimia.bootstrap.currentCompanyId()
   * ```
   *
   * ⚠️ **El token vive lo que viva la petición que lo trajo.** Construye uno por
   * petición y no compartas la instancia: un cliente compartido es una
   * credencial compartida, y aquí la credencial es de un usuario concreto.
   *
   * ⚠️ Un token prestado **no se refresca**: cuando caduca, el 401 sube como
   * {@link UnauthorizedError} y quien tiene que conseguir otro es quien te lo
   * prestó.
   */
  static withBorrowedToken(options: BorrowedTokenOptions): PimiaClient {
    if (options.accessToken.trim() === '') {
      /* Antes de construir nada: un cliente con el token vacío llamaría igual y
         el 401 llegaría desde Pimia, que es tarde y confuso — parece un token
         caducado y es un token que nunca hubo. */
      throw new NotAuthenticatedError(
        'El token prestado está vacío: no hay nada que reenviar. Comprueba la cabecera ' +
          '`Authorization` de la petición que atiendes.',
      )
    }

    return new PimiaClient({
      baseUrl: options.baseUrl,
      // Vacíos: es lo que dice «este cliente no tiene grant propio», y lo que
      // deja `oauth` a null.
      clientId: '',
      redirectUri: '',
      fetch: options.fetch,
      tokens: new BorrowedTokenStore(options.accessToken),
      headers: options.headers,
      maxRateLimitRetries: options.maxRateLimitRetries,
      maxRetryDelayMs: options.maxRetryDelayMs,
    })
  }

  /** Cabeceras `X-RateLimit-*` de la última respuesta. */
  get rateLimit(): RateLimit {
    return { ...this.lastRateLimit }
  }

  get invoices() {
    return {
      list: (query?: RequestOptions['query'], options?: ReadOptions) =>
        this.get<Ok<'invoices.index'>>('/invoices', query, options),
      get: (id: number | string, options?: ReadOptions) =>
        this.get<Ok<'invoices.show'>>(`/invoices/${id}`, undefined, options),
      /**
       * Devuelve `{ data: InvoiceResource }`. El tipo NO sale del spec: el
       * `200` de `invoices.store` está vacío ahí (ver {@link ResourceEnvelope}).
       */
      create: (body: InvoicesRequest, options?: WriteOptions) =>
        this.post<ResourceEnvelope<InvoiceResource>>('/invoices', body, options),
      /** Mismo caso que `create`: el `200` de `invoices.update` no está tipado en el spec. */
      update: (id: number | string, body: InvoicesRequest, options?: WriteOptions) =>
        this.put<ResourceEnvelope<InvoiceResource>>(`/invoices/${id}`, body, options),
    }
  }

  get customers() {
    return {
      list: (query?: RequestOptions['query'], options?: ReadOptions) =>
        this.get<Ok<'customers.index'>>('/customers', query, options),
      get: (id: number | string, options?: ReadOptions) =>
        this.get<Ok<'customers.show'>>(`/customers/${id}`, undefined, options),
      create: (body: CustomerRequest, options?: WriteOptions) =>
        this.post<Ok<'customers.store'>>('/customers', body, options),
      /** El `200` de `customers.update` no está tipado en el spec. */
      update: (id: number | string, body: CustomerRequest, options?: WriteOptions) =>
        this.put<ResourceEnvelope<CustomerResource>>(`/customers/${id}`, body, options),
    }
  }

  get estimates() {
    return {
      list: (query?: RequestOptions['query'], options?: ReadOptions) =>
        this.get<Ok<'estimates.index'>>('/estimates', query, options),
      get: (id: number | string, options?: ReadOptions) =>
        this.get<Ok<'estimates.show'>>(`/estimates/${id}`, undefined, options),
      create: (body: EstimatesRequest, options?: WriteOptions) =>
        this.post<Ok<'estimates.store'>>('/estimates', body, options),

      /**
       * Convierte un presupuesto aceptado en factura.
       *
       * El helper existe porque es el cierre natural del bucle
       * `estimate.accepted` → facturar, y sin él hay que ir por ruta cruda y
       * adivinar la forma de la respuesta.
       *
       * Dos cosas que conviene saber y que el spec no dice:
       *
       *  - **la factura nace BORRADOR y sin numerar**: `data.invoice_number` es
       *    `null` hasta que la publiques cambiando su estado. No es un fallo;
       *  - el id de la factura nueva está en `data.id`. El `r?.data?.id ?? r?.id`
       *    defensivo que se ve por ahí sobra: la segunda rama nunca ocurre.
       *
       * Manda `idempotencyKey` —una clave estable por presupuesto, del estilo
       * `estimate:{id}:invoice`— y el reintento tras un timeout no te creará
       * una segunda factura.
       *
       * Y manda `externalRef` si la venta nació en tu sistema: es lo que hace
       * que `invoice.created` e `invoice.paid` te lleguen con tu referencia en
       * vez de con `null`. **Tiene que ir aquí, en la conversión**; etiquetar
       * después con `PUT /invoices/{id}` llega tarde por dos motivos: para
       * entonces `invoice.created` ya salió con la referencia nula, y entre las
       * dos llamadas hay una ventana en la que la factura existe y no la
       * encuentras por tu referencia.
       *
       * Va como opción y no como segundo parámetro para no romperle la llamada
       * a quien ya hace `convertToInvoice(id, { idempotencyKey })`: el cuerpo lo
       * monta el atajo, y `external_ref` es además el único campo que el
       * endpoint acepta.
       *
       * Exige `estimates:write` **e** `invoices:write`.
       */
      convertToInvoice: (
        id: number | string,
        options?: WriteOptions & { externalRef?: string | null },
      ) => {
        const { externalRef, ...resto } = options ?? {}

        return this.post<ResourceEnvelope<InvoiceResource>>(
          `/estimates/${id}/convert-to-invoice`,
          // Cuerpo vacío si no se pide, y no `external_ref: null`: mandar el
          // null explícito DESVINCULA la referencia, que no es lo mismo que no
          // tocarla.
          externalRef === undefined ? {} : { external_ref: externalRef },
          resto,
        )
      },
    }
  }

  /**
   * Contratos de servicio. Exige `contracts:read` / `contracts:write`.
   *
   * Un contrato GOBIERNA facturas recurrentes: su periodo se vuelve los
   * límites de la recurrente. El ciclo de vida va por sus acciones — el
   * `PUT` no acepta `status`, y fuera de borrador solo toca lo descriptivo
   * (el periodo se cambia con `renew`, que sí propaga).
   */
  get contracts() {
    return {
      list: (query?: RequestOptions['query'], options?: ReadOptions) =>
        this.get<Ok<'contracts.index'>>('/contracts', query, options),
      get: (id: number | string, options?: ReadOptions) =>
        this.get<Ok<'contracts.show'>>(`/contracts/${id}`, undefined, options),
      create: (body: ContractRequest, options?: WriteOptions) =>
        this.post<ResourceEnvelope<ContractResource>>('/contracts', body, options),
      update: (id: number | string, body: ContractRequest, options?: WriteOptions) =>
        this.put<ResourceEnvelope<ContractResource>>(`/contracts/${id}`, body, options),

      /**
       * Activa el contrato: DRAFT → ACTIVE, lo numera, y crea la recurrente
       * gobernada — o adopta la de `recurringInvoiceId` (misma empresa y
       * mismo cliente; sus líneas e impuestos no se tocan).
       *
       * Exige `contracts:write` **e** `invoices:write`: la recurrente que
       * nace emitirá facturas por su cuenta. Manda `idempotencyKey` —una
       * clave estable del estilo `contract:{id}:activate`— y el reintento
       * tras un timeout no te creará una segunda recurrente.
       */
      activate: (
        id: number | string,
        options?: WriteOptions & { recurringInvoiceId?: number | string },
      ) => {
        const { recurringInvoiceId, ...resto } = options ?? {}

        return this.post<ResourceEnvelope<ContractResource>>(
          `/contracts/${id}/activate`,
          recurringInvoiceId === undefined ? {} : { recurring_invoice_id: recurringInvoiceId },
          resto,
        )
      },

      /**
       * Cancela: sus recurrentes quedan en pausa (`ON_HOLD`) y las facturas
       * emitidas conservan el rastro entero.
       */
      cancel: (id: number | string, options?: WriteOptions) =>
        this.post<ResourceEnvelope<ContractResource>>(`/contracts/${id}/cancel`, {}, options),

      /**
       * Renovación manual: extiende `ends_at` (posterior al fin actual) y lo
       * propaga a las recurrentes gobernadas, reviviendo las completadas por
       * el límite viejo.
       */
      renew: (id: number | string, endsAt: string, options?: WriteOptions) =>
        this.post<ResourceEnvelope<ContractResource>>(
          `/contracts/${id}/renew`,
          { ends_at: endsAt },
          options,
        ),

      /**
       * El enlace del PDF para el cliente final: URL FIRMADA con caducidad.
       * Un contrato en borrador —sin número— es un 422.
       */
      sharedLink: (id: number | string, options?: ReadOptions) =>
        this.get<Ok<'contract.sharedLink'>>(`/contracts/${id}/shared-link`, undefined, options),

      /**
       * Sube (o reemplaza: un fichero por colección) el contrato FIRMADO —
       * el papel escaneado. Multiparte por `POST` dedicado; el `FormData` lo
       * arma el atajo, no le pongas `content-type`.
       */
      uploadDocument: (id: number | string, document: Blob, options?: WriteOptions) =>
        this.post<ResourceEnvelope<ContractResource>>(
          `/contracts/${id}/document`,
          toFormData({ document }),
          options,
        ),
    }
  }

  /**
   * Almacenes: la DIMENSIÓN del stock. Exige `items:read` / `items:write` —
   * el almacén cuelga del catálogo que dimensiona, sin scope propio.
   *
   * ⚠️ **Vive tras el módulo `stock`, que es opt-in**: si la empresa no lo ha
   * instalado, estas rutas responden `403` con `error: module_not_installed`,
   * y eso NO es un problema de permisos. El libro de movimientos, el ajuste
   * con motivo y la mercancía recibida son de todos y no pasan por aquí.
   *
   * Exactamente un almacén lleva `is_default`, y es el que hereda todo
   * movimiento que no elige otro. El saldo por almacén es el REPARTO del
   * contador global: su suma por artículo es exactamente `opening_stock`.
   */
  get warehouses() {
    return {
      list: (query?: RequestOptions['query'], options?: ReadOptions) =>
        this.get<Ok<'warehouses.index'>>('/warehouses', query, options),
      get: (id: number | string, options?: ReadOptions) =>
        this.get<Ok<'warehouses.show'>>(`/warehouses/${id}`, undefined, options),
      create: (body: WarehouseRequest, options?: WriteOptions) =>
        this.post<ResourceEnvelope<WarehouseResource>>('/warehouses', body, options),
      update: (id: number | string, body: WarehouseRequest, options?: WriteOptions) =>
        this.put<ResourceEnvelope<WarehouseResource>>(`/warehouses/${id}`, body, options),

      /**
       * Borra un almacén VACÍO y sin historia. Tres negativas con su código:
       * `default_warehouse_required`, `stock_movements_attached` (su pasado
       * explica saldos de hoy) y `stock_attached`. Para el que ya no se usa,
       * `update` con `is_active: false`.
       */
      delete: (id: number | string, options?: ReadOptions) =>
        this.delete<{ success: string }>(`/warehouses/${id}`, options),

      /**
       * Las existencias de UN almacén, artículo a artículo — la pregunta que
       * la dimensión vino a contestar. `only_with_stock` deja fuera los ceros.
       */
      stock: (id: number | string, query?: RequestOptions['query'], options?: ReadOptions) =>
        this.get<Ok<'warehouses.stock'>>(`/warehouses/${id}/stock`, query, options),
    }
  }

  /**
   * Recuentos de inventario: contar un almacén y cuadrarlo de una vez. Exige
   * `items:read` / `items:write` y el módulo `stock` (opt-in), como el resto.
   *
   * El ciclo es **contar → mirar diferencias → confirmar**, y los dos últimos
   * pasos son llamadas distintas a propósito:
   *
   * - `update` escribe lo contado y **no mueve una sola existencia**;
   * - `confirm` emite los ajustes en bloque, uno por línea con diferencia,
   *   todos con motivo `count` y en la misma transacción.
   *
   * ⛔ **Dos cosas que hay que tener delante para no programar contra una
   * aritmética que el servidor no garantiza:**
   *
   * 1. **La diferencia se calcula al CONFIRMAR**, contra el saldo de ese
   *    momento: un recuento dice «aquí hay 12», no «quítale 3». Si algo se
   *    movió entre contar y confirmar, el almacén queda igualmente en lo
   *    contado, y el `meta.moved_while_counting` de la respuesta dice cuántas
   *    líneas fueron.
   * 2. **`counted_quantity: null` es «sin contar», y no es cero.** Las líneas
   *    en null no emiten nada; mandar 0 es declarar que miraste y no había.
   */
  get stockCounts() {
    return {
      list: (query?: RequestOptions['query'], options?: ReadOptions) =>
        this.get<Ok<'stock-counts.index'>>('/stock-counts', query, options),
      get: (id: number | string, options?: ReadOptions) =>
        this.get<Ok<'stock-counts.show'>>(`/stock-counts/${id}`, undefined, options),

      /**
       * Abre el recuento. Nace **sembrado** con lo que el almacén dice tener
       * (`seed`, por defecto sí): contar es corregir una lista, no escribirla.
       */
      create: (body: StockCountRequest, options?: WriteOptions) =>
        this.post<ResourceEnvelope<StockCountResource>>('/stock-counts', body, options),

      /** Cuenta: escribe lo contado. No mueve el almacén. */
      update: (id: number | string, body: StockCountRequest, options?: WriteOptions) =>
        this.put<ResourceEnvelope<StockCountResource>>(`/stock-counts/${id}`, body, options),

      /**
       * Confirma: emite los ajustes en bloque. La respuesta trae el resumen en
       * `meta` — cuántas líneas se ajustaron, cuántas cuadraban, cuántas
       * quedaron sin contar y cuántas se movieron mientras se contaba.
       */
      confirm: (id: number | string, options?: WriteOptions) =>
        this.post<Ok<'stockCounts.confirm'>>(`/stock-counts/${id}/confirm`, {}, options),

      /** Cancela un borrador. Uno confirmado ya movió el almacén: 422. */
      cancel: (id: number | string, options?: WriteOptions) =>
        this.post<Ok<'stockCounts.cancel'>>(`/stock-counts/${id}/cancel`, {}, options),

      /**
       * Borra un recuento que no ha movido nada. Uno confirmado **no se
       * borra**: sus asientos explican el saldo de hoy.
       */
      delete: (id: number | string, options?: ReadOptions) =>
        this.delete<{ success: string }>(`/stock-counts/${id}`, options),
    }
  }

  /**
   * El libro del almacén: por qué un artículo tiene el saldo que tiene. Exige
   * `items:read` — leer el libro es leer el catálogo que explica— y, a
   * diferencia de almacenes y recuentos, **NO va tras el módulo `stock`**: el
   * libro es N1 y N1 es de todos.
   *
   * ## El COMPROMETIDO, en la cabecera de `forItem`
   *
   * `meta.committed` responde la otra mitad de la pregunta: no «cuánto tengo»
   * sino **«cuánto de lo que tengo puedo vender»**. Trae la cantidad, el
   * disponible (saldo − comprometido) y el DESGLOSE de los documentos que lo
   * comprometen.
   *
   * ⛔ **Tres cosas que hay que tener delante:**
   *
   * 1. **Es una cifra DERIVADA**: no hay columna que escribir, no existe un
   *    `PUT` para reservar. Comprometen el albarán y la factura **en
   *    borrador**, y dejan de hacerlo solos cuando mueven el almacén (al
   *    entregar y al publicar). El presupuesto aceptado NO compromete: nada en
   *    el núcleo dice cuándo se cumplió.
   * 2. ⚠️ **`committed` a `null` NO es cero.** Es «no se está calculando» — la
   *    empresa no tiene el módulo `stock`, o tiene el ciclo de inventario
   *    apagado. Pintar un 0 ahí afirma «nada comprometido», que es justo lo
   *    que no se sabe. Igual con `committed_quantity` en el artículo.
   * 3. **Es GLOBAL por artículo, sin dimensión de almacén**: de los documentos
   *    que comprometen solo el albarán declara almacén.
   */
  get stockMovements() {
    return {
      /**
       * El libro entero de la empresa, filtrable por artículo, almacén, motivo
       * y fechas. Su `meta` trae además el valor informativo del almacén
       * (`stock_value_cents`), que NO es valoración contable.
       */
      list: (query?: RequestOptions['query'], options?: ReadOptions) =>
        this.get<Ok<'stockMovements.index'>>('/stock-movements', query, options),

      /**
       * El libro de UN artículo, con la cabecera que lo explica: saldo
       * (`meta.opening_stock`), reparto por almacén (`meta.warehouse_stock`) y
       * comprometido (`meta.committed`).
       */
      forItem: (
        itemId: number | string,
        query?: RequestOptions['query'],
        options?: ReadOptions,
      ) =>
        this.get<Ok<'stockMovements.forItem'>>(
          `/items/${itemId}/stock-movements`,
          query,
          options,
        ),

      /**
       * El ajuste manual con motivo: la corrección que deja rastro, frente al
       * `PUT /items/{item}` que pisa el contador sin decir por qué. Cantidad
       * FIRMADA (± decimal) y `note` obligatoria; `warehouse_id` opcional.
       */
      adjust: (
        itemId: number | string,
        body: { quantity: number; note: string; warehouse_id?: number },
        options?: WriteOptions,
      ) =>
        this.post<Ok<'item.stockAdjustments'>>(
          `/items/${itemId}/stock-adjustments`,
          body,
          options,
        ),
    }
  }

  /**
   * Oportunidades: **a quién va dirigido** un presupuesto.
   *
   * `estimates.opportunity_id` es el enlace transparente del núcleo —funciona
   * venga el CRM de donde venga—, y es lo que permite preguntar «los
   * presupuestos de este trato» sin que el trato viva en Pimia. Pero hasta el
   * 2026-09-08 una oportunidad **sólo podía nacer dentro de un
   * `POST /estimates`**, así que un CRM de fuera no tenía forma de estrenar una
   * al dar de alta un lead: habría tenido que fabricar un presupuesto borrador y
   * quemar un número de la serie del cliente por cada lead. Un lead no es una
   * oferta.
   *
   * No estrena scope: cuelga de `estimates:write`, porque la oportunidad es a
   * quién va dirigido un presupuesto y no una entidad del embudo.
   *
   * ⚠️ **Todavía no está en el spec publicado** (galeote/factSaas#805 es más
   * nueva que la última sincronización del contrato). Contra una instancia
   * anterior a esa ruta la llamada contesta 404, y eso es lo que hay que mirar
   * antes de dar por hecho que el token está mal.
   */
  get opportunities() {
    return {
      /**
       * Estrena una oportunidad. Manda `idempotencyKey` —una clave estable por
       * lead, del estilo `lead:{id}:opportunity`— y el reintento tras un timeout
       * no te estrenará una segunda para el mismo trato.
       */
      create: (body: OpportunityRequest, options?: WriteOptions) =>
        this.post<ResourceEnvelope<OpportunityResource>>('/opportunities', body, options),
    }
  }

  /**
   * Lo que el CRM de Pimia publica para que OTRO CRM pueda sustituirlo.
   *
   * No son los leads —ésos los sirve `/crm/leads` y un integrador que trae su
   * propio embudo no los usa—: es lo que un CRM sustituto necesita del núcleo
   * aunque se haya llevado el embudo a su casa.
   */
  get crm() {
    return {
      /**
       * Las personas a las que se les puede asignar una tarea o un lead.
       *
       * **Reenvía lo que conteste**, campos de más incluidos. Recortarlo tú es
       * aplicar dos veces la misma política desde dos sitios que pueden
       * divergir: Pimia esconde aquí a los superadmin de la plataforma y a la
       * gestoría dueña del tenant, y recorta cada fila a `id` y `name`. Si
       * mañana añade un campo para desempatar dos nombres iguales, tu copia lo
       * borraría sin que nadie entendiera por qué.
       *
       * ⚠️ El scope: el contrato publicado la cobra con `crm:read`, pero el
       * núcleo la abrió el 2026-09-08 a cualquier token válido de la empresa
       * —precisamente para que un integrador que SUSTITUYE el CRM no tenga que
       * pedir el scope del CRM que ya no usa—. Contra una instancia anterior a
       * ese cambio sigue haciendo falta `crm:read`.
       */
      assignableUsers: (options?: ReadOptions) =>
        this.get<Ok<'crm.assignableUsers'>>('/crm/assignable-users', undefined, options),
    }
  }

  /**
   * El arranque de la sesión: en qué empresa trabaja este token y con qué
   * moneda.
   *
   * ⛔ **`/bootstrap` NO envuelve en `data`.** Todo lo demás en el API contesta
   * `{ data: … }`; ésta no: sus claves cuelgan de la raíz. Un desenvolvedor de
   * `data` escrito «para todas las llamadas» no encuentra nada aquí y devuelve
   * vacío **sin error**, así que el fallo no se ve como un fallo: se ve como una
   * empresa sin resolver o como una moneda que cae al respaldo. Medido
   * construyendo el CRM de la vertical, que tuvo que anotarlo en su código y en
   * el arnés de sus tests.
   *
   * Lectura libre: la alcanza cualquier token válido, **sin scope** y sin
   * consentimiento adicional del dueño del tenant.
   *
   * ⚠️ Cada método hace SU llamada: no hay caché. Es a propósito —el cliente no
   * sabe cuánto vive una sesión tuya, y una empresa cacheada de más es una fila
   * escrita en la empresa equivocada—, así que si necesitas las dos cosas en la
   * misma petición, llama a `get()` una vez y léelas del objeto.
   */
  get bootstrap() {
    return {
      /** El arranque entero, sin envolver. */
      get: (options?: ReadOptions) =>
        this.get<Ok<'general.bootstrap'>>('/bootstrap', undefined, options),

      /**
       * En qué empresa trabaja ESTA petición, según el núcleo.
       *
       * ⛔ No es «la primera empresa del usuario», aunque hoy coincidan. Pimia
       * resuelve `current_company` con el mismo camino y el mismo respaldo que
       * usa su middleware de empresa para servir cualquier otra llamada tuya —la
       * cabecera `company` si vale, y si no la primera del usuario—, así que
       * preguntarlo aquí es la única forma de que tu lado y el suyo no puedan
       * discrepar. Deducirlo de la lista de `/me` reproduce la regla en un
       * segundo sitio, y dos reglas iguales son dos reglas que pueden separarse:
       * el día que dejaran de coincidir, escribirías con una empresa que Pimia
       * nunca usó y sin un solo error que lo denuncie.
       *
       * `null` si el arranque no la publica. Trátalo como «no se puede servir
       * esta sesión» y no como un cero: un cero es una empresa que no es de
       * nadie y que ve cualquiera que también acabe ahí.
       *
       * ⚠️ El spec declara `current_company` obligatorio y el tipo generado dice
       * que siempre está; la comprobación de aquí es de RUNTIME porque se ha
       * visto llegar sin ella. Cuando eso pasa, lo que hay que devolver es
       * `null`, no reventar.
       */
      currentCompanyId: async (options?: ReadOptions): Promise<number | null> => {
        const body = await this.get<Ok<'general.bootstrap'>>('/bootstrap', undefined, options)
        const id = (body as { current_company?: { id?: unknown } }).current_company?.id

        return typeof id === 'number' ? id : null
      },

      /**
       * La moneda de la empresa y su ESCALA.
       *
       * ⛔ La moneda no es siempre el euro y los decimales cambian con ella: el
       * yen tiene 0, el dinar kuwaití 3. Suponer 2 —o peor, multiplicar por 100
       * a mano— no da un error, da otro resultado: un filtro por importe
       * devuelve otras filas y un alta guarda una moneda falsa en la ficha. Por
       * eso la escala se PREGUNTA.
       *
       * `null` si el arranque no publica moneda (el campo admite nulo en el
       * contrato), y ahí el SDK **no se inventa nada**: «EUR con 2 decimales» es
       * una política de producto, la decide quien llama. Lo que sí se lee a la
       * defensiva es `precision`, que el contrato declara obligatorio dentro de
       * la moneda: un cuerpo sin él está roto, no es un caso de negocio.
       */
      currency: async (
        options?: ReadOptions,
      ): Promise<{ code: string; precision: number } | null> => {
        const body = await this.get<Ok<'general.bootstrap'>>('/bootstrap', undefined, options)
        const currency = body.current_company_currency

        if (!currency || typeof currency.code !== 'string') return null

        return {
          code: currency.code,
          precision: typeof currency.precision === 'number' ? currency.precision : 2,
        }
      },
    }
  }

  get<T = unknown>(
    path: string,
    query?: RequestOptions['query'],
    options?: ReadOptions,
  ): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET', query })
  }

  post<T = unknown>(path: string, body?: unknown, options?: WriteOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body })
  }

  put<T = unknown>(path: string, body?: unknown, options?: WriteOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body })
  }

  patch<T = unknown>(path: string, body?: unknown, options?: WriteOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body })
  }

  delete<T = unknown>(path: string, options?: ReadOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' })
  }

  /**
   * Descarga un fichero de la API y te lo da como `Blob`.
   *
   * Son dos operaciones: el membrete de una plantilla
   * (`GET /invoice-templates/{id}/letterhead`) y el documento escaneado de una
   * factura recibida (`GET /received-invoices/{id}/show/document`).
   *
   * Existe porque `get()` **corrompe un binario sin decirlo**: lee la
   * respuesta con `response.text()`, y un PDF pasado por ahí llega entero de
   * tamaño y no se abre. Ese es el peor final posible para una descarga, así
   * que la forma correcta tiene nombre propio en vez de ser una bandera que
   * hay que acordarse de poner.
   *
   * ```ts
   * const pdf = await client.download(`/received-invoices/${id}/show/document`)
   * const url = URL.createObjectURL(pdf)
   * ```
   */
  download(
    path: string,
    query?: RequestOptions['query'],
    options?: ReadOptions,
  ): Promise<Blob> {
    return this.request<Blob>(path, {
      ...options,
      method: 'GET',
      query,
      responseType: 'blob',
    })
  }

  /**
   * Petición cruda contra `/api/v1`. `path` puede llevar el prefijo o no:
   * `/invoices` y `/api/v1/invoices` son lo mismo.
   */
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { data } = await this.requestWithMeta<T>(path, options)

    return data
  }

  /**
   * Lo mismo que {@link request}, pero devuelve también los metadatos de la
   * respuesta.
   *
   * Existe por la idempotencia: tras un reintento, el cuerpo es idéntico al de
   * la primera llamada —ese es justo el contrato—, así que el cuerpo solo no
   * dice si Pimia escribió o se limitó a repetirse. `meta.idempotentReplay` sí.
   *
   * ```ts
   * const clave = crypto.randomUUID()
   * const { data, meta } = await client.requestWithMeta('/estimates', {
   *   method: 'POST', body, idempotencyKey: clave,
   * })
   * if (meta.idempotentReplay) log('el presupuesto ya existía; no se duplicó')
   * ```
   */
  async requestWithMeta<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<ResponseWithMeta<T>> {
    /* El cuerpo se clasifica UNA vez, fuera del bucle: lo que se manda no
       cambia entre el intento y su reintento, y decidirlo dentro invitaría a
       que algún día dejaran de coincidir. */
    const cuerpoNativo = esCuerpoNativo(options.body)
    if (cuerpoNativo) {
      exigirSinContentType(options.body, { ...this.extraHeaders, ...options.headers })
    }

    let tokens = await this.currentTokens()

    if (isExpired(tokens, this.skew)) {
      tokens = await this.refreshTokens(tokens)
    }

    let attempt = 0
    let refreshedOn401 = false

    for (;;) {
      const response = await this.doFetch(this.urlFor(path, options.query), {
        method: options.method ?? 'GET',
        headers: {
          /* Una descarga no pide JSON: si se dejara `application/json` fijo, un
             servidor que negocie el tipo tendría derecho a contestar 406 —o a
             mandar un JSON de error donde se esperaba el fichero. */
          accept: options.responseType === 'blob' ? '*/*' : 'application/json',
          /* Un cuerpo nativo trae su propio tipo: el runtime le pone
             `multipart/form-data` CON su `boundary`, o el de un `Blob`, o
             `application/x-www-form-urlencoded`. Escribirlo aquí a mano se lo
             quitaría, y sin `boundary` el servidor no puede parsear nada. */
          ...(options.body === undefined || cuerpoNativo
            ? {}
            : { 'content-type': 'application/json' }),
          ...this.extraHeaders,
          ...options.headers,
          // Después de `options.headers` para que la opción con nombre mande
          // sobre una cabecera puesta a mano: si alguien usa las dos, la
          // explícita del API es la que quiso de verdad.
          ...(options.idempotencyKey === undefined
            ? {}
            : { 'idempotency-key': options.idempotencyKey }),
          authorization: `Bearer ${tokens.accessToken}`,
        },
        body:
          options.body === undefined
            ? undefined
            : cuerpoNativo
              ? (options.body as BodyInit)
              : JSON.stringify(options.body),
        signal: options.signal,
      })

      this.captureRateLimit(response)

      if (response.ok) {
        return {
          /* Una descarga se devuelve como `Blob` SIN pasar por `parseBody`,
             que hace `response.text()`: un PDF leído como texto se corrompe en
             la primera secuencia que no sea UTF-8 válido, y lo hace en
             silencio — el fichero «llega» y no se abre. */
          data: (options.responseType === 'blob'
            ? await response.blob()
            : await parseBody(response)) as T,
          meta: {
            status: response.status,
            // Presente solo cuando Pimia reproduce; su ausencia significa
            // «esta escritura ocurrió de verdad».
            idempotentReplay: response.headers.get('idempotency-replayed') === 'true',
            requestId: response.headers.get('x-request-id') ?? undefined,
            rateLimit: this.lastRateLimit,
          },
        }
      }

      const body = await parseBody(response)
      const requestId = response.headers.get('x-request-id') ?? undefined

      // 401: un intento de refresco y se reintenta. Si el usuario revocó la
      // app, el refresh también falla y el error sube tal cual — hay que
      // volver a pedirle autorización.
      if (response.status === 401 && !refreshedOn401 && tokens.refreshToken) {
        refreshedOn401 = true
        tokens = await this.refreshTokens(tokens)
        continue
      }

      if (response.status === 429 && attempt < this.maxRateLimitRetries) {
        attempt++
        await sleep(this.retryDelay(response, attempt))
        continue
      }

      if (response.status === 429) {
        throw new RateLimitError(
          retryAfterSeconds(response),
          429,
          'Rate limit alcanzado',
          body,
          requestId,
        )
      }

      throw PimiaApiError.from(response.status, body, requestId)
    }
  }

  private async currentTokens(): Promise<TokenSet> {
    const tokens = await this.store.load()

    if (!tokens?.accessToken) {
      throw new NotAuthenticatedError(
        'No hay tokens en el TokenStore: completa el flujo de autorización antes de llamar a la API.',
      )
    }

    return tokens
  }

  /**
   * Refresca UNA sola vez aunque lo pidan N peticiones en paralelo, y persiste
   * el resultado. Sin esta serialización, dos peticiones caducadas a la vez
   * canjearían el mismo refresh y el servidor lo leería como reuse → grant
   * revocado en cascada.
   */
  private async refreshTokens(current: TokenSet): Promise<TokenSet> {
    if (this.refreshing) return this.refreshing

    if (this.oauth === null) {
      /* Token prestado: no hay grant propio con el que refrescar. Hoy no se
         llega aquí —sin `refreshToken` el 401 sube tal cual—, y el guardia está
         para que el día que ese camino cambie el error diga lo que pasa en vez
         de reventar contra un `null`. */
      throw new UnauthorizedError(
        401,
        'Este cliente usa un token prestado y no puede refrescarlo: pide uno nuevo a ' +
          'quien te lo prestó.',
        null,
      )
    }

    if (!current.refreshToken) {
      throw new UnauthorizedError(
        401,
        'El access token caducó y no hay refresh token: vuelve a pedir autorización al usuario.',
        null,
      )
    }

    this.refreshing = (async () => {
      try {
        const rotated = await this.oauth!.refresh(current.refreshToken!)
        await this.store.save(rotated)

        return rotated
      } catch (error) {
        // Un refresco fallido significa siempre lo mismo para quien llama:
        // este grant ya no vale y hay que volver a pedir autorización al
        // usuario (revocó la app, caducó el refresh, o se reusó uno rotado).
        // Se traduce a UnauthorizedError para que un solo `catch` cubra el
        // caso: sin esto, el error del token endpoint (OAuthError
        // invalid_grant) se colaba por debajo del contrato del cliente —
        // detectado en el e2e real contra dev al revocar desde el panel.
        if (error instanceof OAuthError) {
          const unauthorized = new UnauthorizedError(
            401,
            `No se pudo refrescar el token (${error.error}): vuelve a pedir autorización al usuario.`,
            null,
          )
          unauthorized.cause = error

          throw unauthorized
        }

        throw error
      } finally {
        this.refreshing = null
      }
    })()

    return this.refreshing
  }

  private urlFor(path: string, query: RequestOptions['query']): string {
    const clean = path.replace(/^\/+/, '').replace(/^api\/v1\/?/, '')
    const url = new URL(`${this.baseUrl}/api/v1/${clean}`)

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(`${key}[]`, String(item))
        continue
      }
      url.searchParams.set(key, String(value))
    }

    return url.toString()
  }

  private captureRateLimit(response: Response): void {
    const limit = response.headers.get('x-ratelimit-limit')
    const remaining = response.headers.get('x-ratelimit-remaining')

    this.lastRateLimit = {
      limit: limit === null ? undefined : Number(limit),
      remaining: remaining === null ? undefined : Number(remaining),
    }
  }

  private retryDelay(response: Response, attempt: number): number {
    const retryAfter = retryAfterSeconds(response)
    const base = retryAfter !== undefined ? retryAfter * 1000 : 2 ** attempt * 500

    return Math.min(base, this.maxRetryDelayMs)
  }
}

/**
 * ¿Es un cuerpo que el runtime serializa por su cuenta?
 *
 * Los cinco de la lista tienen dos cosas en común, y las dos importan: `fetch`
 * sabe convertirlos y **se pueden releer**. Lo segundo es lo que decide quién
 * entra: este cliente reintenta ante un 401 (después de refrescar) y ante un
 * 429, así que un cuerpo de un solo uso —un `ReadableStream`— reventaría en el
 * reintento con un «body already used» que no se parece en nada a su causa.
 *
 * Los `typeof … !== 'undefined'` no son celo: este paquete corre en Node y en
 * el navegador, y aunque Node 20 los trae todos, un runtime recortado que no
 * tenga `FormData` debe fallar en el `instanceof`, no al evaluarlo.
 */
function esCuerpoNativo(body: unknown): boolean {
  if (body === undefined || body === null) return false

  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  )
}

/**
 * Un `FormData` con un `content-type` puesto a mano **no se manda**: se avisa.
 *
 * La cabecera de un multipart lleva el `boundary` que separa las partes, y lo
 * genera el runtime al serializar. Escribir `content-type:
 * multipart/form-data` a mano se lo quita, y entonces el servidor recibe un
 * cuerpo que no puede parsear: contesta un 422 sobre un campo obligatorio que
 * el cliente **sí mandó**, y el rastro no lleva a ninguna parte.
 *
 * Es un error de quien llama, no de la API, así que se lanza aquí y no se
 * intenta arreglar por su cuenta: quitarle la cabecera en silencio dejaría en
 * pie la creencia de que hacía falta.
 */
function exigirSinContentType(body: unknown, headers: Record<string, string>): void {
  if (typeof FormData === 'undefined' || !(body instanceof FormData)) return

  const puesta = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type')
  if (puesta === undefined) return

  throw new TypeError(
    'No le pongas `content-type` a un cuerpo FormData: el runtime escribe el suyo ' +
      'con el `boundary` que separa las partes, y una cabecera a mano se lo quita ' +
      `(el servidor respondería 422 sobre un campo que sí mandaste). Quita \`${puesta}\` ` +
      'de las cabeceras de esta petición.',
  )
}

/**
 * Arma el `FormData` de una operación multipart con las conversiones que el
 * servidor de Pimia espera, que **no** son las que hace `FormData` sola.
 *
 * Tres reglas, y las tres salen del contrato, no de la costumbre:
 *
 * - **Los booleanos viajan como `1` y `0`.** Lo dice el propio spec en
 *   `ExpenseRequest.is_attachment_receipt_removed`: «en `multipart/form-data`
 *   viaja como `1` o `0`». Un `String(false)` daría `"false"`, que PHP lee
 *   como verdadero.
 * - **Los objetos y arrays viajan como JSON en una cadena.** También del
 *   spec, en `ExpenseRequest.customFields`: «viaja como cadena JSON:
 *   `[{"id":3,"value":"REF-42"}]`».
 * - **`null` y `undefined` se omiten**, en vez de mandar `"null"`. Un campo
 *   ausente es un campo ausente; la cadena `"null"` es un valor.
 *
 * Un `Blob` o un `File` se añaden tal cual. Con un `File` el runtime manda ya
 * su nombre; con un `Blob` suelto se puede dar uno pasando `[blob, 'x.pdf']`,
 * que es la forma que el tercer argumento de `append` admite.
 *
 * ```ts
 * await client.post('/expenses', toFormData({
 *   expense_date: '2026-08-24',
 *   expense_category_id: 3,
 *   amount: 12100,
 *   attachment_receipt: ficheroPdf,
 *   customFields: [{ id: 3, value: 'REF-42' }],
 * }))
 * ```
 */
export function toFormData(
  fields: Record<string, unknown | [Blob, string]>,
): FormData {
  const form = new FormData()

  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue

    if (Array.isArray(value) && value.length === 2 && esBlob(value[0]) && typeof value[1] === 'string') {
      form.append(name, value[0] as Blob, value[1])
      continue
    }

    if (esBlob(value)) {
      form.append(name, value as Blob)
      continue
    }

    if (typeof value === 'boolean') {
      form.append(name, value ? '1' : '0')
      continue
    }

    if (typeof value === 'object') {
      form.append(name, JSON.stringify(value))
      continue
    }

    form.append(name, String(value))
  }

  return form
}

function esBlob(value: unknown): boolean {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('retry-after')
  if (header === null) return undefined
  const seconds = Number(header)

  return Number.isFinite(seconds) ? seconds : undefined
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null

  const text = await response.text()
  if (text === '') return null

  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('json')) return text

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
