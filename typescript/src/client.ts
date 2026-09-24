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

import { normalizeBaseUrl } from './base-url.js'
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
 * Destinatario y correo de firma; la forma pertenece al contrato del núcleo.
 *
 * Desde el #934 acepta `document_version_id`: la `reference` de la revisión
 * que se acaba de revisar en {@link PimiaClient.contracts}`.documentPreview()`.
 * Es `nullable` en la validación y **obligatoria bajo el bloqueo cuando el
 * contrato usa un modelo de clausulado** — la regla la decide el estado de la
 * fila, no la forma del cuerpo—, así que un contrato sin modelo se sigue
 * enviando sin ella. Una referencia inválida nunca cae a ese camino: es un 422.
 */
export type ContractSignatureRequest = operations['contract.sendContractForSignature']['requestBody']['content']['application/json']
/**
 * Los cuatro modos de facturación de un contrato (decisión 11 del núcleo
 * #932). Salen del enum del `ContractRequest`, así que si el núcleo añade un
 * quinto, aparece al regenerar los tipos y no en producción.
 *
 * El modo manda sobre el resto de la ficha, y eso no es cosmética: `amount` y
 * `billing_every` solo son datos reales en `INSTALLMENTS`, y `total_amount`
 * solo en `MILESTONES` y `ONE_OFF`. En los demás llegan a `null`, que
 * significa «este contrato no tiene eso» y **no** «no consta».
 */
export type ContractBillingMode = NonNullable<ContractRequest['billing_mode']>

/**
 * Los cuatro modos como valor, para pintar un selector sin escribirlos a mano.
 * El orden es el del núcleo: `INSTALLMENTS` primero porque es el que heredan
 * los contratos anteriores al #933.
 */
export const CONTRACT_BILLING_MODES = [
  'INSTALLMENTS',
  'MILESTONES',
  'ONE_OFF',
  'NONE',
] as const satisfies readonly ContractBillingMode[]

/** Un hito tal y como lo devuelve la API: importe en céntimos y `position` ya resuelta. */
export type ContractMilestoneResource = Schemas['ContractMilestoneResource']

/**
 * Un hito tal y como se MANDA.
 *
 * ⚠️ Los hitos viajan como CONJUNTO: omitir `milestones` conserva los que
 * haya y mandarla —aunque sea `[]`— la sustituye entera. La API no acepta ids
 * de hito, y eso no es un olvido del contrato: es lo que impide adjuntar al
 * tuyo el hito de otro contrato.
 *
 * ⛔ Un hito es GUÍA: no emite factura, no marca cobro y `planned_date` no es
 * un vencimiento. La factura de un hito se crea a mano con `contract_id`.
 */
export type ContractMilestoneInput = NonNullable<ContractRequest['milestones']>[number]

/**
 * Una versión PUBLICADA de un modelo. Es inmutable: publicar la v2 no toca la
 * v1 ni los contratos que la eligieron, que es lo que permite saber qué texto
 * firmó cada cliente.
 *
 * `compatible_modes` se DEDUCE de los marcadores que el texto usa y no se
 * declara: un modelo que imprime la cuota mensual solo sirve para un contrato
 * de cuotas. `variables_used` es el inventario de esos marcadores.
 *
 * ⚠️ Los tres campos se estrechan a mano: el generador los publica como
 * `unknown[]` porque el recurso del núcleo devuelve columnas JSON sin tipar.
 */
export type ContractModelVersionResource = Omit<
  Schemas['ContractModelVersionResource'],
  'content' | 'compatible_modes' | 'variables_used'
> & {
  content: ContractModelBlock[]
  compatible_modes: ContractBillingMode[]
  variables_used: string[]
}

/**
 * Un modelo de clausulado de la empresa: su borrador, su versión publicada y
 * su historial.
 *
 * `draft_revision` es el número que hay que devolver al guardar contenido
 * (ver {@link ContractModelRequest}). `status` es `ACTIVE` o `ARCHIVED`:
 * archivar retira de las selecciones NUEVAS y no borra nada. `seed_key` no
 * nulo = lo trajo Pimia, y eso se dice, no se adivina por el nombre.
 *
 * ⚠️ `draft_content` y las versiones se estrechan a mano, por lo mismo que
 * arriba; `published_version` y `versions` solo vienen cuando la operación las
 * carga (el detalle trae el historial, el listado no).
 */
export type ContractModelResource = Omit<
  Schemas['ContractModelResource'],
  'draft_content' | 'published_version' | 'versions'
> & {
  draft_content: ContractModelBlock[] | null
  published_version?: ContractModelVersionResource | null
  versions?: ContractModelVersionResource[]
}

/**
 * El modelo tal como lo devuelven `get` y `publish`: el spec añade ahí
 * `required: ["versions"]`, así que el historial se garantiza y no hace falta
 * guardarlo contra `undefined`.
 */
export type ContractModelDetailResource = ContractModelResource & {
  versions: ContractModelVersionResource[]
}

/** El sobre de un listado de modelos; el spec no tipa la paginación de Laravel. */
export interface ContractModelListEnvelope {
  data: ContractModelResource[]
}

/**
 * Dónde cae la firma en el papel: página y caja en PORCENTAJE de la página.
 *
 * ⚠️ Es un OBJETO, y el tipo generado dice `unknown[]`: la columna es JSON y
 * el generador la leyó como lista. Un panel que hiciera `.length` sobre esto
 * no vería nada. La forma está medida contra `PdfAnchorLocator::locate()`.
 * `null` en la caja = se supo la página pero no se pudo medir el recuadro.
 */
export interface ContractSignaturePlacement {
  page: number
  page_count: number
  left: number | null
  top: number | null
  width: number | null
  height: number | null
}

/**
 * La REVISIÓN DOCUMENTAL de un contrato: el papel exacto que se preparó.
 *
 * `reference` es el asa con la que se envía a firmar
 * (`signature.send(..., { document_version_id })`). `source_document_sha256`
 * identifica los BYTES y es **evidencia, no autorización**: el servidor lo
 * vuelve a comprobar todo bajo bloqueo, y un hash que traiga el navegador no
 * autoriza nada. Tampoco promete que el PDF firmado tenga este hash: al
 * colocar la firma, el proveedor reescribe su propio documento.
 *
 * ⚠️ `implicit_preview: true` = esta revisión la preparó el propio envío
 * porque el contrato no usa modelo y nadie mandó referencia. **No acredita que
 * nadie haya visto el papel.**
 */
export type ContractDocumentVersionResource = Omit<
  Schemas['ContractDocumentVersionResource'],
  'expected_signature_field' | 'signature_fields' | 'data_snapshot'
> & {
  /** Dónde ESPERA el papel su firma, medido sobre sus propios bytes. */
  expected_signature_field: ContractSignaturePlacement | null
  /** Dónde la colocó el proveedor DE VERDAD; `null` hasta que se envía. */
  signature_fields: Record<string, unknown>[] | null
  /** La ficha resuelta que se archivó: contexto, modelo, tarjeta y partes. */
  data_snapshot: Record<string, unknown>
}

/**
 * Un trozo de texto del clausulado. `bold` es el único formato: el editor de
 * la empresa no es un maquetador.
 */
export interface ContractModelTextInline {
  type: 'text'
  value: string
  bold?: boolean
}

/**
 * Un MARCADOR de dato dentro del texto. `key` es una clave del diccionario de
 * `contracts.models.variables()`; una que no exista ahí es un 422 con su
 * nombre, nunca un hueco en silencio.
 */
export interface ContractModelVariableInline {
  type: 'variable'
  key: string
  bold?: boolean
}

export type ContractModelInline = ContractModelTextInline | ContractModelVariableInline

/** Encabezado de 1 a 3 niveles: más jerarquía que esa no es un contrato. */
export interface ContractModelHeadingBlock {
  type: 'heading'
  level?: 1 | 2 | 3
  text: ContractModelInline[]
}

export interface ContractModelParagraphBlock {
  type: 'paragraph'
  text: ContractModelInline[]
}

/** Una lista; cada item es su propia fila de trozos de texto y marcadores. */
export interface ContractModelListBlock {
  type: 'list'
  ordered?: boolean
  items: ContractModelInline[][]
}

/**
 * Una tabla rellenada por un marcador de tipo `table` —hoy solo
 * `contract.milestones`—. Un dato de tabla dentro de un párrafo es un 422.
 */
export interface ContractModelTableBlock {
  type: 'table'
  variable: string
}

/**
 * Dónde firma el cliente. No lleva datos: su contenido entero es el ancla que
 * el núcleo escribe en el PDF, y el SDK no la compone ni la nombra.
 *
 * ⛔ Uno por modelo, ni cero ni dos: sin él no hay sitio donde firmar y con
 * dos el proveedor colocaría dos campos. Publicar lo exige; guardar un
 * borrador a medias, no.
 */
export interface ContractModelSignatureBlock {
  type: 'signature'
}

/**
 * Un bloque del clausulado. El árbol es DELIBERADAMENTE plano —bloques, y
 * dentro trozos de texto o marcadores— y nada más: ni HTML, ni condiciones, ni
 * bucles, ni acceso a relaciones.
 *
 * ⚠️ **Este tipo se escribe a mano, y es a propósito.** La regla del núcleo es
 * `['nullable', 'array']`, así que el generador del spec publica
 * `content: string[] | null` — una lista de cadenas, que no es lo que el
 * servidor valida. Tomar ese tipo tal cual habría hecho que el árbol correcto
 * no compilase. La forma de aquí está medida contra
 * `app/ContractModels/ContentSchema.php` del núcleo, y sus límites vivos los
 * publica `contracts.models.variables()` en `meta.limits` / `meta.block_types`:
 * léelos de ahí en vez de clavarlos.
 */
export type ContractModelBlock =
  | ContractModelHeadingBlock
  | ContractModelParagraphBlock
  | ContractModelListBlock
  | ContractModelTableBlock
  | ContractModelSignatureBlock

/**
 * Cuerpo de alta/edición de un modelo de clausulado.
 *
 * Sin `status` a propósito: archivar es su propia acción, como
 * `activate`/`cancel` en los contratos. Y `draft_revision` es obligatoria
 * **cuando mandas `content`**: es la revisión que leíste, y quien llega con
 * una vieja recibe un 409 con el porqué en vez de pisar el texto del otro.
 * Omitir `content` conserva el borrador; mandarlo lo sustituye entero.
 *
 * `content` se estrecha a {@link ContractModelBlock}: ver el porqué allí.
 */
export type ContractModelRequest = Omit<Schemas['ContractModelRequest'], 'content'> & {
  content?: ContractModelBlock[] | null
}

/** El tipo de dato de un marcador; decide cómo lo imprime el núcleo. */
export type ContractVariableType = 'text' | 'long_text' | 'date' | 'integer' | 'money' | 'table'

/**
 * Una entrada del diccionario de marcadores.
 *
 * ⚠️ **También se escribe a mano**: el `200` de la operación publica
 * `data: unknown[]` porque el controlador devuelve un `response()->json()` que
 * el generador no sabe mirar dentro. La forma está medida contra
 * `app/ContractModels/VariableDictionary.php` del núcleo.
 *
 * - `modes`: con qué modos es compatible. Un marcador de cuota no existe en un
 *   contrato por hitos, y ofrecerlo sería un bloqueo cinco pantallas después.
 * - `required`: si el modelo lo usa y el dato falta, la preparación se BLOQUEA.
 *   Un dato opcional en la ficha puede ser obligatorio para el modelo que lo
 *   imprime.
 * - `empty_as`: la única representación declarada del vacío (`open_ended` para
 *   un contrato sin fin, `blank` para la descripción). Ahí la ausencia ES el dato.
 * - `guarded`: además de existir, hay que PODER VERLO — hoy `project.name`. Se
 *   vuelve a comprobar al descargar el papel: los bytes archivados no heredan
 *   el permiso con el que se crearon.
 * - `example`: sirve para enseñarlo en el menú; no es el valor del contrato.
 */
export interface ContractModelVariable {
  key: string
  label: string
  type: ContractVariableType
  format: string | null
  modes: ContractBillingMode[]
  required: boolean
  empty_as: string | null
  guarded: boolean
  example: string
}

/**
 * Lo que el diccionario dice ADEMÁS de sus entradas: las versiones que se
 * graban en cada versión publicada, los tipos que el editor puede producir y
 * los límites vivos del esquema. Sale del spec, así que un límite nuevo llega
 * al regenerar.
 */
export type ContractModelVariablesMeta = Ok<'contract.contractModelVariables'>['meta']

/** Respuesta de `contracts.models.variables()`: el diccionario y su `meta`. */
export interface ContractModelVariablesResponse {
  data: ContractModelVariable[]
  meta: ContractModelVariablesMeta
}

/**
 * Cuerpo de la vista previa. Declarar el destinatario ATA la revisión a ese
 * firmante: enviarla a otro exigirá preparar otra. No declararlo no es un
 * agujero —el papel no imprime el nombre del firmante— pero deja pasar un
 * cambio de destinatario sin obligar a revisar.
 */
export type ContractDocumentPreviewRequest = NonNullable<
  operations['contractDocumentPreview.store']['requestBody']
>['content']['application/json']

/**
 * La revisión preparada y la URL con la que se descargan SUS bytes.
 *
 * `download_url` es la ruta de `documentPreviewDownload()` ya compuesta por el
 * servidor; el PDF no se regenera nunca, porque un PDF horneado de nuevo sería
 * otro documento.
 */
export type ContractDocumentPreview = Omit<Ok<'contractDocumentPreview.store'>, 'data'> & {
  data: ContractDocumentVersionResource
}

/**
 * El 422 que BLOQUEA una preparación o un envío: qué falta, dato por dato.
 *
 * ⚠️ El spec publica el 422 genérico de validación (`message` + `errors`)
 * porque el controlador contesta con un `response()->json()` que el generador
 * no inspecciona; `blockers` está medido en
 * `ContractDocumentPreviewController` y en `SendContractForSignatureController`
 * del núcleo. Por eso se lee con {@link contractDocumentBlockers} en vez de
 * afirmarse desde el tipo generado.
 */
export interface ContractDocumentBlocked {
  success: false
  message: string
  blockers: string[]
}

/**
 * Los motivos de un bloqueo, o `undefined` si el error no trae ninguno.
 *
 * ```ts
 * try {
 *   await client.contracts.documentPreview(7)
 * } catch (e) {
 *   const motivos = contractDocumentBlockers(e)
 *   if (motivos) mostrarBloqueo(motivos) // TODOS, no solo el primero
 * }
 * ```
 *
 * ⛔ Un bloqueo **no se reintenta solo**: ni preparando otra revisión ni
 * reenviando la firma. Falta un dato o la revisión dejó de ser vigente, y las
 * dos cosas las arregla una persona, no un bucle. Preparar otra vez también
 * hornea OTRO PDF, que es justo lo que la decisión 7 del #932 prohíbe hacer en
 * silencio.
 */
export function contractDocumentBlockers(error: unknown): string[] | undefined {
  const body = error instanceof PimiaApiError ? error.body : error

  if (!body || typeof body !== 'object') return undefined

  const blockers = (body as { blockers?: unknown }).blockers

  return Array.isArray(blockers) && blockers.every((b) => typeof b === 'string')
    ? (blockers as string[])
    : undefined
}
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
 *
 * Desde la 0.29.0 sale del spec (`/api/v1` 1.1.0); hasta entonces se escribía a
 * mano con los mismos cuatro campos.
 */
export type OpportunityRequest = Schemas['OpportunityRequest']

/**
 * Una oportunidad recién creada: `id`, `name`, `contact_name`, `email` y
 * `phone`. Desde la 0.29.0 sale del `201` del spec; antes era
 * `{ id: number; [key: string]: unknown }`.
 */
export type OpportunityResource = Ok<'opportunity.opportunities'>['data']

/**
 * Cuerpo de `POST /billing/integrador/portal` (`/api/v1` 1.1.0): `return_url`,
 * a dónde vuelve el cliente desde el portal de Stripe. Tiene que ser de uno de
 * los orígenes registrados de la app de su vertical; si no, 422
 * `return_url_no_permitida`.
 */
export type IntegradorBillingPortalRequest =
  operations['suscripcionIntegrador.portal']['requestBody'] extends {
    content: { 'application/json': infer B }
  }
    ? B
    : never

/** El estado de la suscripción del cliente en el Stripe de su integrador (`data` de `billing.integrador.subscription()`). */
export type IntegradorSubscription = Ok<'suscripcionIntegrador.show'>['data']

/**
 * Códigos de corte de `billing.integrador` (`PimiaApiError.code`):
 * - 404 `suscripcion_no_disponible`: el integrador de esta instancia no le
 *   cobra por Stripe (o no hay suscripción).
 * - 409 `suscripcion_de_baja`, `suscripcion_modificada`, `stripe_plan_unknown`.
 * - 422 `return_url_no_permitida` (solo el portal).
 * - 503 `stripe_unavailable`: reintentar (solo el portal).
 */
export type IntegradorBillingCorteCode =
  | 'suscripcion_no_disponible'
  | 'suscripcion_de_baja'
  | 'suscripcion_modificada'
  | 'stripe_plan_unknown'
  | 'return_url_no_permitida'
  | 'stripe_unavailable'

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
 * Se prueba el `200` primero porque es el caso mayoritario. El recordatorio
 * de firma solo publica `202`: conservar ese cuerpo evita inferir `never` y
 * no convierte el correo aceptado para envío en un correo ya entregado.
 */
type Ok<O extends keyof operations> = operations[O] extends {
  responses: { 200: { content: { 'application/json': infer Body } } }
}
  ? Body
  : operations[O] extends {
        responses: { 201: { content: { 'application/json': infer Body } } }
      }
    ? Body
    : operations[O] extends {
          responses: { 202: { content: { 'application/json': infer Body } } }
        }
      ? Body
      : never

/**
 * Un buzón del inventario administrativo del correo. Se escribe a partir de la
 * respuesta de `PATCH /mail/admin/mailboxes/{mailbox}` porque la del ALTA
 * (`POST`, `201`) sale del generador como el literal `201` en vez del recurso:
 * usarla tal cual tiparía `data` como un número. Misma forma en el núcleo
 * (`MailPresenter::adminMailbox`).
 */
export type MailAdminMailboxResource = Ok<'mailAdminMailboxes.update'>['data']


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
  /** Origen de la API, sin `/api` ni barra final (p. ej. `https://acme.pimia.es`): el cliente añade `/api/v1/…`. La barra final se tolera por compatibilidad. */
  baseUrl: string
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
  /** Origen de la API, sin `/api` ni barra final (p. ej. `https://acme.pimia.es`): el cliente añade `/api/v1/…`. La barra final se tolera por compatibilidad. */
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
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
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
   * El ciclo de vida va por sus acciones — el `PUT` no acepta `status`, y
   * fuera de borrador solo toca lo descriptivo (el periodo se cambia con
   * `renew`, que sí propaga).
   *
   * ── El MODO manda sobre el resto de la ficha (#933) ──────────────────────
   *
   * Desde la decisión 11 hay cuatro {@link ContractBillingMode}, y no todos
   * facturan:
   *
   * | modo           | qué lleva                    | al activar          |
   * |----------------|------------------------------|---------------------|
   * | `INSTALLMENTS` | `amount` + `billing_every`   | crea/adopta recurrente |
   * | `MILESTONES`   | `total_amount?` + `milestones` | nada           |
   * | `ONE_OFF`      | `total_amount?`              | nada                |
   * | `NONE`         | nada económico               | nada                |
   *
   * Un campo ajeno al modo es un 422, no un dato que se ignore. `customer_id`
   * sigue siendo obligatorio en los cuatro. Y un alta que no declara
   * `billing_mode` se resuelve al persistido o a `INSTALLMENTS`: los contratos
   * anteriores al #933 son de cuotas y siguen comportándose igual.
   *
   * ⛔ Solo `INSTALLMENTS` GOBIERNA facturas recurrentes. En los otros tres no
   * hay recurrente NUNCA —`recurring_invoices: []` lo dice, y `[]` es
   * «ninguna», no «no te lo cuento»— y los hitos son GUÍA: no emiten factura
   * ni marcan cobro. La factura de un hito se crea a mano con `contract_id`
   * (`invoices.create({ …, contract_id })`) y aparece bajo el contrato.
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
       * El catálogo de clausulados de la empresa (#934).
       *
       * ⛔ Sus permisos son PROPIOS: poder editar o enviar un contrato no
       * concede redactar ni publicar modelos (`view-contract-model`,
       * `create-contract-model`, `edit-contract-model`,
       * `publish-contract-model`, `archive-contract-model`). El scope sigue
       * siendo `contracts:read` / `contracts:write`.
       */
      models: {
        /**
         * Los modelos de la empresa activa. Por defecto solo los `ACTIVE`,
         * porque el listado sirve sobre todo para ELEGIR y un archivado no se
         * puede elegir; `{ status: 'ALL' }` devuelve también los archivados y
         * `{ limit: 'all' }`, la lista entera sin paginar.
         *
         * ⚠️ El spec no tipa la paginación, así que el tipo solo promete
         * `data`: con `limit` numérico la respuesta trae además `links` y
         * `meta` de Laravel.
         */
        list: (query?: RequestOptions['query'], options?: ReadOptions) =>
          this.get<ContractModelListEnvelope>('/contract-models', query, options),
        /**
         * Un modelo con su borrador, su versión publicada y su historial.
         *
         * ⚠️ Los siete atajos devuelven {@link ContractModelResource}, que
         * estrecha a mano lo que el spec deja en `unknown[]`, y no el tipo
         * generado. En `show` y `publish` había además una segunda razón: su
         * `200` sale del generador como objeto opaco, y usarlo tal cual
         * afirmaría que `data` **no tiene propiedades**.
         */
        get: (id: number | string, options?: ReadOptions) =>
          this.get<ResourceEnvelope<ContractModelDetailResource>>(
            `/contract-models/${id}`,
            undefined,
            options,
          ),
        create: (body: ContractModelRequest, options?: WriteOptions) =>
          this.post<ResourceEnvelope<ContractModelResource>>('/contract-models', body, options),
        /**
         * Edita el nombre y el borrador. Mandar `content` exige la
         * `draft_revision` que leíste: si otra edición guardó mientras tanto,
         * el núcleo responde **409** con el porqué y no pisa su texto. Vuelve
         * a leer el modelo y reaplica; no reintentes con el mismo número.
         */
        update: (id: number | string, body: ContractModelRequest, options?: WriteOptions) =>
          this.put<ResourceEnvelope<ContractModelResource>>(
            `/contract-models/${id}`,
            body,
            options,
          ),
        /**
         * Publica el borrador como versión inmutable. Aquí SÍ se exige el
         * bloque de firma, y los modos compatibles se DEDUCEN de los
         * marcadores usados: no se declaran.
         *
         * ⛔ Publicar la v2 no toca la v1 ni los contratos que la eligieron.
         * Nunca elijas «la última» en silencio: la versión es una decisión.
         */
        publish: (id: number | string, options?: WriteOptions) =>
          this.post<ResourceEnvelope<ContractModelDetailResource>>(
            `/contract-models/${id}/publish`,
            {},
            options,
          ),
        /**
         * Retira el modelo de las selecciones NUEVAS. No borra versiones ni
         * contratos: los que ya apuntan a una de sus versiones siguen
         * imprimiendo y firmando ese texto.
         */
        archive: (id: number | string, options?: WriteOptions) =>
          this.post<ResourceEnvelope<ContractModelResource>>(
            `/contract-models/${id}/archive`,
            {},
            options,
          ),
        /**
         * El diccionario de marcadores, con etiqueta, tipo, formato,
         * requisito, permiso y ejemplo. Con `billing_mode` devuelve solo lo
         * que ESE modo tiene de verdad, que es lo que impide ofrecer «cuota
         * mensual» al redactar el modelo de un contrato por hitos.
         *
         * `meta` trae los tipos de bloque, los de inline y los límites vivos
         * del esquema: léelos de ahí en vez de clavarlos en el panel.
         */
        variables: (
          query?: { billing_mode?: ContractBillingMode | null },
          options?: ReadOptions,
        ) =>
          this.get<ContractModelVariablesResponse>(
            '/contract-models/variables',
            query,
            options,
          ),
      },

      /**
       * Prepara el papel y devuelve su REVISIÓN: `reference`, hash, tamaño,
       * si lleva ancla y dónde la espera. **No envía**: no crea envelope, no
       * manda correos y no consume intento de firma.
       *
       * El recorrido es preparar → revisar los bytes con
       * {@link documentPreviewDownload} → enviar con esa `reference` en
       * `signature.send`.
       *
       * ⛔ Si falta un dato, el núcleo responde 422 con TODOS los motivos
       * ({@link contractDocumentBlockers}). No lo reintentes solo: cada
       * preparación hornea otro PDF y retira la revisión anterior.
       */
      documentPreview: (
        id: number | string,
        body?: ContractDocumentPreviewRequest,
        options?: WriteOptions,
      ) =>
        this.post<ContractDocumentPreview>(
          `/contracts/${id}/document-preview`,
          body ?? {},
          options,
        ),

      /**
       * Los bytes EXACTOS que se enviarán a firmar, servidos del archivo y
       * nunca regenerados. Devuelve un `Blob`; pásale la `reference` de la
       * revisión (o la `download_url` que trae la preview, que es esta misma
       * ruta).
       *
       * ⚠️ Puede ser 403 aunque la preview funcionara: los marcadores que
       * exigen permiso sobre lo que nombran —hoy el nombre de la obra— se
       * vuelven a comprobar al entregar el papel.
       */
      documentPreviewDownload: (
        id: number | string,
        reference: string,
        options?: ReadOptions,
      ) => this.download(`/contracts/${id}/document-preview/${reference}`, undefined, options),

      /**
       * Firma del cliente: `signingUrl` solo vuelve en `send` y es una
       * capacidad para firmar; no debe registrarse ni exponerse en listados.
       * `status` lee el estado del núcleo con `contracts:read`; las otras
       * acciones exigen `contracts:write`. Completar la firma no activa el
       * contrato: esa decisión sigue siendo de la empresa.
       */
      signature: {
        send: (id: number | string, body: ContractSignatureRequest, options?: WriteOptions) =>
          this.post<Ok<'contract.sendContractForSignature'>>(`/contracts/${id}/signature`, body, options),
        status: (id: number | string, options?: ReadOptions) =>
          this.get<Ok<'contract.contractSignatureStatus'>>(`/contracts/${id}/signature`, undefined, options),
        cancel: (id: number | string, options?: ReadOptions) =>
          this.delete<Ok<'contract.cancelContractSignature'>>(`/contracts/${id}/signature`, options),
        /** El 202 acepta el recordatorio manual; no crea otro envío de firma. */
        remind: (id: number | string, options?: WriteOptions) =>
          this.post<Ok<'contract.remindContractSignature'>>(`/contracts/${id}/signature/remind`, {}, options),
      },

      /**
       * Activa el contrato: DRAFT → ACTIVE, lo numera, y crea la recurrente
       * gobernada — o adopta la de `recurringInvoiceId` (misma empresa y
       * mismo cliente; sus líneas e impuestos no se tocan).
       *
       * ⚠️ **Solo en `INSTALLMENTS`.** Desde el #933, `MILESTONES`, `ONE_OFF`
       * y `NONE` pasan a ACTIVE con las mismas guardas —numeración, firma
       * vigente, bloqueo, idempotencia— y sin crear ni una recurrente ni una
       * factura; `recurringInvoiceId` en esos modos es un 422, no una
       * adopción silenciosa. El `invoices:write` es el máximo que declara el
       * contrato público y solo se exige de verdad en el modo que factura,
       * resuelto con el modo PERSISTIDO y no con el que mande el cliente.
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
   * Publicada en el contrato desde `/api/v1` 1.1.0 (galeote/factSaas#805).
   * Contra una instancia anterior a esa ruta la llamada contesta 404, y eso es
   * lo que hay que mirar antes de dar por hecho que el token está mal.
   */
  get opportunities() {
    return {
      /**
       * Estrena una oportunidad. Manda `idempotencyKey` —una clave estable por
       * lead, del estilo `lead:{id}:opportunity`— y el reintento tras un timeout
       * no te estrenará una segunda para el mismo trato.
       */
      create: (body: OpportunityRequest, options?: WriteOptions) =>
        this.post<Ok<'opportunity.opportunities'>>('/opportunities', body, options),
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
       * Sin scope: la alcanza cualquier token válido de la empresa —para que
       * un integrador que SUSTITUYE el CRM no tenga que pedir el scope del CRM
       * que ya no usa—. El contrato lo publica así desde `/api/v1` 1.1.0 (antes
       * decía `crm:read`). Contra una instancia anterior al 2026-09-08 sigue
       * haciendo falta `crm:read`.
       */
      assignableUsers: (options?: ReadOptions) =>
        this.get<Ok<'crm.assignableUsers'>>('/crm/assignable-users', undefined, options),
    }
  }

  /**
   * La suscripción del CLIENTE en el Stripe de su integrador (`/api/v1` 1.1.0,
   * galeote/factSaas#835 parte B): lo que un integrador que cobra con Stripe
   * enseña en el perfil de su cliente para cambiar de plan o darse de baja.
   *
   * No es la facturación de Pimia (`billing:*`, reservada a la primera parte):
   * sus scopes son `integrador-billing:read` y `integrador-billing:write`, y
   * además exige que el usuario del token sea dueño o administrador de la
   * empresa (403 si no). Siguen abiertas con la instancia suspendida.
   *
   * No hay `cancel` ni `changePlan`, a propósito: todo pasa por el portal de
   * Stripe. Subir de plan es inmediato y cobra la diferencia; bajar o cancelar
   * se aplica al final del periodo, y el GET no anuncia las bajadas pendientes.
   * Los cortes, en {@link IntegradorBillingCorteCode}.
   */
  get billing() {
    return {
      integrador: {
        /**
         * `GET /billing/integrador/subscription`: los planes publicados de la
         * vertical (`planes`, `currency`), el estado en Stripe
         * (`stripe_status`, `cancel_at_period_end`, `current_period_end`), la
         * mora (`debe_desde`, `baja_en`) y lo contratado hoy (`hoy`).
         */
        subscription: (options?: ReadOptions) =>
          this.get<Ok<'suscripcionIntegrador.show'>>(
            '/billing/integrador/subscription',
            undefined,
            options,
          ),
        /**
         * `POST /billing/integrador/portal`: la URL (`data.url`) del portal de
         * Stripe para esta suscripción. Redirige a ella en el momento: la sesión
         * del portal caduca pronto, así que no la guardes.
         */
        portal: (body: IntegradorBillingPortalRequest, options?: WriteOptions) =>
          this.post<Ok<'suscripcionIntegrador.portal'>>('/billing/integrador/portal', body, options),
      },
    }
  }

  /**
   * El correo de la empresa sobre Dead Simple Email (módulo de pago `mail`),
   * fase A del núcleo: conexión, buzones, lectura y administración. Exige
   * `mail:read` / `mail:write`, que son de **primera parte**: un client de
   * integrador no los obtiene.
   *
   * Tres puertas en todas las rutas, y el cuerpo de error trae el `code`
   * estable ({@link PimiaApiError.code}):
   *
   * 1. el módulo: `403 module_not_installed` si está apagado;
   * 2. la empresa activa: un id de otra empresa (o de otro buzón) es `404`;
   * 3. la membresía: el contenido exige ser miembro **vivo**; administrar
   *    (`configure-mail`) no da contenido y un admin sin membresía recibe
   *    `403 mailbox_access_revoked`.
   *
   * {@link mailAccessClosure} dice si un error CIERRA el acceso (hay que
   * retirar lo pintado) o es un fallo pasajero. Un fallo del proveedor es
   * `502`/`503` y nunca un `200` con la lista vacía.
   *
   * ⚠️ Los ids de buzón, mensaje, adjunto y propuesta son `public_id`
   * opacos (cadenas); los de USUARIO son el id numérico de Pimia.
   */
  get mail() {
    return {
      connection: {
        /** La conexión de la INSTANCIA (una por proveedor). Sin conexión: `status: not_configured`, no un 404. */
        get: (options?: ReadOptions) => this.get<Ok<'mailConnection.show'>>('/mail/connection', undefined, options),
        /** Conecta (o reconecta) Dead Simple. La clave viaja una vez y no vuelve en ninguna respuesta. */
        connect: (body: components['schemas']['MailConnectionRequest'], options?: WriteOptions) =>
          this.post<Ok<'mailConnection.store'>>('/mail/connection', body, options),
        /** Desconecta la instancia entera. Idempotente: responde `not_configured`. */
        disconnect: (options?: ReadOptions) => this.delete<Ok<'mailConnection.destroy'>>('/mail/connection', options),
      },

      /** Los buzones que quien mira puede LEER (membresía viva). `[]` si no hay ninguno. */
      mailboxes: (options?: ReadOptions) => this.get<Ok<'mailboxes.index'>>('/mail/mailboxes', undefined, options),

      messages: {
        /**
         * Por cursor: `meta.next_cursor` (opaco, se devuelve tal cual) y
         * `meta.history_complete` en cada página. `folder`: `inbox` o `sent`.
         */
        list: (mailboxId: string, query?: RequestOptions['query'], options?: ReadOptions) =>
          this.get<Ok<'mailMessages.index'>>(`/mail/mailboxes/${encodeURIComponent(mailboxId)}/messages`, query, options),
        /** El mensaje en TEXTO PLANO (`text_body`); el HTML no sale nunca. */
        get: (mailboxId: string, messageId: string, options?: ReadOptions) =>
          this.get<Ok<'mailMessages.show'>>(
            `/mail/mailboxes/${encodeURIComponent(mailboxId)}/messages/${encodeURIComponent(messageId)}`,
            undefined,
            options,
          ),
        /** Leído o no leído, POR USUARIO. Responde `204`. */
        markRead: (mailboxId: string, messageId: string, read: boolean, options?: WriteOptions) =>
          this.patch<void>(
            `/mail/mailboxes/${encodeURIComponent(mailboxId)}/messages/${encodeURIComponent(messageId)}`,
            { read } satisfies components['schemas']['MailMessageUpdateRequest'],
            options,
          ),
      },

      /** Descarga un adjunto como `Blob` (el cuerpo es binario; `get()` lo corrompería). */
      attachment: (mailboxId: string, attachmentId: string, options?: ReadOptions) =>
        this.download(
          `/mail/mailboxes/${encodeURIComponent(mailboxId)}/attachments/${encodeURIComponent(attachmentId)}`,
          undefined,
          options,
        ),

      proposals: {
        /** Las propuestas de Hermes de un buzón, por cursor. */
        list: (mailboxId: string, query?: RequestOptions['query'], options?: ReadOptions) =>
          this.get<Ok<'mailProposals.index'>>(`/mail/mailboxes/${encodeURIComponent(mailboxId)}/proposals`, query, options),
        get: (proposalId: string, options?: ReadOptions) =>
          this.get<Ok<'mailProposals.show'>>(`/mail/proposals/${encodeURIComponent(proposalId)}`, undefined, options),
      },

      /** Administración (`configure-mail`): metadatos y miembros, SIN contenido. */
      admin: {
        mailboxes: {
          /** Todos los buzones de la empresa activa, con su número de miembros. */
          list: (options?: ReadOptions) =>
            this.get<Ok<'mailAdminMailboxes.index'>>('/mail/admin/mailboxes', undefined, options),
          /**
           * Da de alta un buzón. **`idempotencyKey` es OBLIGATORIA** (el
           * núcleo la exige y la reenvía al proveedor): una por alta, y la
           * MISMA en el reintento tras un `502 provider_outcome_unknown`, o
           * se crearían dos buzones. `personal` exige `owner_user_id`; un
           * `shared` nace sin miembros (tampoco quien lo crea).
           */
          create: (
            body: components['schemas']['MailboxStoreRequest'],
            options: WriteOptions & { idempotencyKey: string },
          ) => this.post<ResourceEnvelope<MailAdminMailboxResource>>('/mail/admin/mailboxes', body, options),
          update: (mailboxId: string, body: components['schemas']['MailboxUpdateRequest'], options?: WriteOptions) =>
            this.patch<Ok<'mailAdminMailboxes.update'>>(
              `/mail/admin/mailboxes/${encodeURIComponent(mailboxId)}`,
              body,
              options,
            ),
          /** Los buzones de la cuenta del proveedor, para vincular (`mode: link`). Sin ids del proveedor. */
          providerMailboxes: (query?: RequestOptions['query'], options?: ReadOptions) =>
            this.get<Ok<'mailAdminMailboxes.providerMailboxes'>>('/mail/admin/provider-mailboxes', query, options),
        },
        members: {
          list: (mailboxId: string, options?: ReadOptions) =>
            this.get<Ok<'mailAdminMembers.index'>>(
              `/mail/admin/mailboxes/${encodeURIComponent(mailboxId)}/members`,
              undefined,
              options,
            ),
          /** Usuarios de la EMPRESA DEL BUZÓN que aún no son miembros. */
          candidates: (mailboxId: string, options?: ReadOptions) =>
            this.get<Ok<'mailAdminMembers.candidates'>>(
              `/mail/admin/mailboxes/${encodeURIComponent(mailboxId)}/member-candidates`,
              undefined,
              options,
            ),
          /** Un usuario de otra empresa es `422 user_not_in_company`; uno inexistente, `404`. */
          add: (mailboxId: string, userId: number, options?: WriteOptions) =>
            this.post<Ok<'mailAdminMembers.store'>>(
              `/mail/admin/mailboxes/${encodeURIComponent(mailboxId)}/members`,
              { user_id: userId } satisfies components['schemas']['MailboxMemberRequest'],
              options,
            ),
          /** Revoca la membresía (no la borra: queda en el libro). */
          remove: (mailboxId: string, userId: number, options?: ReadOptions) =>
            this.delete<Ok<'mailAdminMembers.destroy'>>(
              `/mail/admin/mailboxes/${encodeURIComponent(mailboxId)}/members/${userId}`,
              options,
            ),
        },
      },
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
