/**
 * Cliente del PLANO CENTRAL de Pimia para el integrador (cuenta de
 * desarrollador): su cartera de clientes, los vínculos con cada instancia, sus
 * clients OAuth, las invitaciones, el patrocinio y el traspaso de propiedad.
 *
 * No es el cliente de un tenant ({@link PimiaClient}, que habla con
 * `https://{tenant}.pimia.es/api/v1` con un token OAuth por instancia): este
 * habla con el ÁPICE (`https://pimia.es/api`) con el **token personal de
 * Sanctum** de la cuenta de desarrollador, acotado por plano
 * (galeote/factSaas#731): `desarrollador` abre `/desarrollador/*` y `central`
 * abre invitaciones, patrocinio y traspaso. Cada operación del contrato dice
 * cuál exige (`x-pimia-required-ability`); un token sin ella recibe un
 * {@link MissingAbilityError} con la habilidad que falta.
 *
 * Lo que NO hace, a propósito: refrescar nada (el token personal no caduca ni
 * rota; se revoca desde el panel) ni leer contenido fiscal de ningún cliente —
 * a los datos de una instancia se llega por OAuth consentido, con el otro
 * cliente.
 *
 * Los tipos salen de `spec/pimia-central-v1.json` (`./central-api`).
 */
import type { operations } from './central-api.js'
import { NotAuthenticatedError, PimiaApiError, RateLimitError } from './errors.js'

/** El cuerpo JSON de la respuesta de éxito (200 o 201) de una operación del contrato. */
type Ok<O extends keyof operations> = operations[O] extends {
  responses: { 200: { content: { 'application/json': infer Body } } }
}
  ? Body
  : operations[O] extends {
        responses: { 201: { content: { 'application/json': infer Body } } }
      }
    ? Body
    : never

/** El cuerpo JSON que pide una operación del contrato. */
type Body<O extends keyof operations> = operations[O] extends {
  requestBody: { content: { 'application/json': infer B } }
}
  ? B
  : operations[O] extends { requestBody?: { content: { 'application/json': infer B } } }
    ? B
    : never

/**
 * Cuerpo de `POST /billing/sponsorship`: la instancia y el plan de canal con
 * que se paga; `return_url` (1.4.0) es a dónde vuelve el integrador desde el
 * Checkout del canal —solo se acepta el origen del panel central o el del
 * ápice; lo demás vuelve al panel Vue—.
 */
export type SponsorshipRequest = Body<'billing.sponsor'>
/** Cuerpo de `POST /billing/portal` (1.4.0): `return_url`, con la misma regla que el patrocinio. */
export type BillingPortalRequest = Body<'billing.portal'>
/** Cuerpo de `POST /tenant-invitations`: a quién se invita y quién paga (`billing`). */
export type TenantInvitationRequest = Body<'tenantInvitation.store'>
/** Cuerpo de `POST /tenants/{slug}/transfer-ownership`: el usuario de la instancia que pasa a ser dueño. */
export type TransferOwnershipRequest = Body<'tenant.transferOwnership'>
/**
 * Cuerpo de `PUT /desarrollador/catalogo`: el catálogo del integrador ENTERO —
 * la moneda ISO 4217 y las filas (`kind` ∈ `base|module|app`, `slug`,
 * `price_cents` en subunidades de esa moneda, `contract_url` propio opcional,
 * `enabled`)—. Lo que no venga deja de existir.
 *
 * ⚠️ Desde el contrato 1.9.0 ya no lleva cabecera de marca: el nombre
 * comercial, el soporte y el enlace de contratación son de cada VERTICAL
 * (`PATCH /desarrollador/verticales/{v}`), y `perfil` sale siempre `null`.
 */
export type CatalogoDelIntegradorRequest = Body<'integradorCatalogo.update'>
/**
 * Cuerpo de `POST /desarrollador/tenants/{slug}/activaciones`: qué se activa al
 * cliente (`kind` ∈ `base|module|app`, `slug`; `plan_id` solo si hay varios
 * planes de canal).
 */
export type ActivacionMayoristaRequest = Body<'integradorActivacion.store'>
/**
 * Cuerpo de `POST /desarrollador/dominios`. ⚠️ Desde el contrato 1.9.0 pide
 * `vertical`: el nombre de login es de una vertical del integrador, no de la
 * cuenta.
 */
export type IntegradorDominioRequest = Body<'integradorDominio.store'>
export type IntegradorTokenRequest = Body<'integradorToken.store'>

/**
 * Cuerpo de `PUT /desarrollador/correo` (1.15.0): `mail_driver` (`smtp` |
 * `ses`), el remitente, `reply_to` opcional y los datos del driver. Los
 * secretos (`mail_password`, `mail_ses_secret`) no vuelven nunca: omitirlos
 * conserva el guardado, mandarlos lo sustituye.
 */
export type IntegradorCorreoRequest = Body<'integradorCorreo.update'>
/** Cuerpo de `POST /desarrollador/correo/prueba`: `to` y, opcionales, `subject` y `message`. */
export type CorreoPruebaRequest = Body<'integradorCorreo.prueba'>
/** Por qué no salió la prueba (`error`): sin cuenta guardada, o el envío falló. */
export type CorreoPruebaError = 'mail_not_configured' | 'mail_send_failed'
/**
 * Con `mail_send_failed`, la causa (`reason`), de lista cerrada. El texto que
 * conteste el servidor de correo no se devuelve.
 */
export type CorreoPruebaReason =
  | 'connection_failed'
  | 'auth_failed'
  | 'tls_failed'
  | 'rejected'
  | 'timeout'
  | 'unknown'
/**
 * La respuesta de la prueba: siempre `200`; se mira `success`. El spec publica
 * `error` y `reason` como `string`; aquí se estrechan a su lista cerrada
 * (docs/changelog-desarrollador.md del núcleo, 2026-09-14).
 */
export type CorreoPruebaResult = Omit<Ok<'integradorCorreo.prueba'>, 'error' | 'reason'> & {
  error?: CorreoPruebaError
  reason?: CorreoPruebaReason
}
/**
 * Códigos de corte del correo del integrador (`PimiaApiError.code`):
 * `mail_host_not_allowed` es el 422 de un `mail_host` que no es público (IP
 * privada, local, reservada o que no resuelve).
 */
export type CorreoCorteCode = 'mail_host_not_allowed'

/**
 * Cuerpo de `PUT /desarrollador/stripe` (1.15.0): `publishable_key` (`pk_`),
 * `secret_key` (`sk_`; `rk_` restringida, opcional), `webhook_secret`
 * (`whsec_`, opcional; `null` lo borra y apaga la recepción) y `mode`
 * (`test` | `live`). `publishable_key` y `mode` van en cada PUT; omitir un
 * secreto lo conserva.
 */
export type IntegradorStripeRequest = Body<'integradorStripe.update'>
/**
 * Códigos de corte del Stripe del integrador (`PimiaApiError.code`). Ninguno
 * guarda cambios:
 * - 422 `stripe_key_invalid`: falta la clave en el alta o Stripe no la autentica.
 * - 422 `stripe_key_permissions`: clave `rk_` sin lectura; el cuerpo trae
 *   `missing_permissions` ({@link StripeMissingPermission}).
 * - 422 `stripe_mode_mismatch`: prefijos o `livemode` que no casan con `mode`.
 * - 429 `stripe_too_many_attempts`: cinco fallos en una hora; llega como
 *   `RateLimitError`, con `retry_after` en el cuerpo y `Retry-After`.
 * - 503 `stripe_unavailable`: Stripe no contesta; se reintenta.
 */
export type StripeCorteCode =
  | 'stripe_key_invalid'
  | 'stripe_key_permissions'
  | 'stripe_mode_mismatch'
  | 'stripe_too_many_attempts'
  | 'stripe_unavailable'
  /**
   * 409 (1.16.0) de `PUT` y `DELETE`: el integrador tiene suscripciones de
   * clientes sin dar de baja (también pendientes), así que no puede
   * desvincular ni cambiar de cuenta o de modo. Rotar la clave de la MISMA
   * cuenta y modo sí se permite.
   */
  | 'stripe_account_in_use'
/** Lo que le falta a una clave restringida: identificadores del contrato, no scopes OAuth. */
export type StripeMissingPermission = 'account:read' | 'balance:read'
/**
 * Los eventos que hay que marcar al dar de alta el endpoint en Stripe
 * (`stripe.get().data.webhook_events`). Desde 1.16.0 son siete: los dos
 * `payment_intent.*` de siempre y los cinco del cobro de suscripciones
 * (`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
 * `customer.subscription.updated`, `customer.subscription.deleted`).
 */
export type StripeWebhookEvent = Ok<'integradorStripe.show'>['data']['webhook_events'][number]

/**
 * Código de corte de `PUT /desarrollador/tenants/{slug}/contratacion` (1.16.0):
 * 409 si el cliente paga por Stripe. Lo contratado lo manda su suscripción, no
 * el PUT manual. Esa operación no tiene helper: se llama con `request()`.
 */
export type ContratacionCorteCode = 'contratacion_gestionada_por_stripe'

/**
 * Cuerpo de `PUT /desarrollador/facturacion-a-clientes` (1.16.0): los TRES
 * ajustes a la vez —`factura_con_pimia`, `tenant_emisor_id` (una de las
 * `emisoras` del GET; `null` al desactivar) y `tipo_iva` (0 a 100, hasta dos
 * decimales)—. Separados de `/stripe` para no reenviar credenciales.
 */
export type FacturacionAClientesRequest = Body<'integradorFacturacionClientes.update'>

/**
 * Estado de la factura de un cobro del integrador. Sale del filtro `estado` del
 * contrato; el spec publica el campo de la fila como `string` y aquí se
 * estrecha a esta lista.
 *
 * - `pendiente`: lista para la cola.
 * - `pendiente_alta`: pago recibido, el alta aún no tiene instancia.
 * - `pendiente_sin_nif`: sin NIF y por encima de 400 € (o en otra moneda): no
 *   cabe simplificada. Reintentable tras corregir.
 * - `error`: emisión o encolado incompletos; `motivo` dice qué. Reintentable.
 * - `emitida`: documento creado y trabajos encolados (no confirma VeriFactu ni
 *   la entrega del correo).
 * - `omitida_sin_facturar_con_pimia`: el interruptor estaba apagado al cobrar.
 *   Encenderlo después no factura hacia atrás.
 * - `omitida_importe_cero`: cobro de importe cero; nunca lleva factura.
 */
export type FacturaAClienteEstado = NonNullable<
  NonNullable<operations['integradorFacturacionClientes.index']['parameters']['query']>['estado']
>
/** Los únicos estados que `facturasAClientes.retry` acepta; los demás contestan 409. */
export type FacturaAClienteReintentable = Extract<FacturaAClienteEstado, 'error' | 'pendiente_sin_nif'>

type FilaFacturaAClienteSpec = Ok<'integradorFacturacionClientes.index'>['data'][number]
/**
 * Una fila de `GET /desarrollador/facturas-a-clientes`: el cobro de Stripe
 * (`stripe_invoice`, `importe_total` en céntimos, `moneda`, `cobrado_en`) y su
 * factura (`estado`, emisora, `invoice_id`, `tipo`, `motivo`, `invoice_url`
 * —la ruta autenticada de la emisora; `null` si no tiene dominio—).
 */
export type FacturaACliente = Omit<FilaFacturaAClienteSpec, 'estado'> & {
  estado: FacturaAClienteEstado
}
/** Una página del listado: hasta 50 filas por id ascendente y el cursor de la siguiente. */
export interface FacturasAClientesPage {
  data: FacturaACliente[]
  /** El `cursor` de la página siguiente, o `null` si no hay más. */
  next_cursor: number | null
}
/** Filtros del listado. `cursor` sale del `next_cursor` de la página anterior. */
export interface FacturasAClientesQuery {
  estado?: FacturaAClienteEstado
  cursor?: number
}
/** La respuesta del reintento: la fila y su estado tras volver a encolarla. */
export interface FacturaAClienteReintento {
  data: Omit<Ok<'integradorFacturacionClientes.retry'>['data'], 'estado'> & {
    estado: FacturaAClienteEstado
  }
}

export interface PimiaCentralClientOptions {
  /** El ápice, sin `/api`: `https://pimia.es` (o `https://taskai.work` en dev). */
  baseUrl: string
  /**
   * El token personal de la cuenta de desarrollador, o una función que lo
   * devuelva (para leerlo de un secreto en cada llamada). Se manda como
   * `Authorization: Bearer`.
   */
  token: string | (() => string | Promise<string>)
  /** `fetch` a usar (por defecto, el global). Útil para tests y proxies. */
  fetch?: typeof globalThis.fetch
  /** Cabeceras fijas para todas las llamadas. */
  headers?: Record<string, string>
}

export interface CentralRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | boolean | undefined | null | Array<string | number>>
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface CentralResponseMeta {
  status: number
  requestId?: string
}

export interface CentralResponseWithMeta<T> {
  data: T
  meta: CentralResponseMeta
}

export class PimiaCentralClient {
  private readonly baseUrl: string
  private readonly token: PimiaCentralClientOptions['token']
  private readonly doFetch: typeof globalThis.fetch
  private readonly extraHeaders: Record<string, string>

  constructor(options: PimiaCentralClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    this.doFetch = options.fetch ?? globalThis.fetch
    this.extraHeaders = options.headers ?? {}
  }

  // ── La cartera y la salud de la integración (habilidad `desarrollador`) ──

  /** `GET /desarrollador/overview`: la cartera, con la atribución de cada alta. */
  overview() {
    return this.request<Ok<'desarrollador.overview'>>('/desarrollador/overview')
  }

  /** `GET /desarrollador/salud`: clients, webhooks y propuestas, solo los propios. */
  salud() {
    return this.request<Ok<'desarrollador.salud'>>('/desarrollador/salud')
  }

  /** `GET /desarrollador/facturacion`: lo que el integrador paga a Pimia (canal y asientos). */
  facturacion() {
    return this.request<Ok<'desarrollador.facturacion'>>('/desarrollador/facturacion')
  }

  // ── El vínculo con cada cliente (habilidad `desarrollador`) ─────────────

  get links() {
    return {
      list: () => this.request<Ok<'desarrolladorLink.index'>>('/desarrollador/links'),
      /** Un código `DEV-XXXX-XXXX` que el cliente teclea en su instancia. */
      generateCode: () =>
        this.request<Ok<'desarrolladorLink.generateCode'>>('/desarrollador/links/generate-code', {
          method: 'POST',
        }),
      accept: (id: number | string) =>
        this.request<Ok<'desarrolladorLink.accept'>>(`/desarrollador/links/${id}/accept`, {
          method: 'POST',
        }),
      reject: (id: number | string) =>
        this.request<Ok<'desarrolladorLink.reject'>>(`/desarrollador/links/${id}/reject`, {
          method: 'POST',
        }),
    }
  }

  // ── Sus clients OAuth (habilidad `desarrollador`) ───────────────────────

  get clients() {
    return {
      list: () => this.request<Ok<'desarrolladorLink.clients'>>('/desarrollador/clients'),
      /**
       * Reclamar un client confidencial CON su secreto: la única prueba de
       * propiedad que el núcleo acepta (RFC 7591). El secreto no se guarda.
       */
      claim: (body: Body<'desarrolladorLink.claimClient'>) =>
        this.request<Ok<'desarrolladorLink.claimClient'>>('/desarrollador/clients/claim', {
          method: 'POST',
          body,
        }),
    }
  }

  // ── Su catálogo: qué revende, a cuánto y a dónde manda a contratar ──────
  //    (habilidad `desarrollador`; punto 12 de DECISIONES.md, regla 4)

  get catalogo() {
    return {
      /**
       * `GET /desarrollador/catalogo`: el catálogo propio (`perfil`, `currency`,
       * `items`) y lo que se puede revender (`disponibles`: Pimia base, los
       * módulos opcionales ofrecidos y las apps integradas activas).
       */
      get: () => this.request<Ok<'integradorCatalogo.show'>>('/desarrollador/catalogo'),
      /**
       * `PUT /desarrollador/catalogo`: reemplaza el catálogo ENTERO. Es lo que
       * el cliente del integrador ve en la pantalla de plan de su instancia en
       * vez de los precios de Pimia; el precio es minorista y no toca el
       * dinero de Pimia.
       */
      replace: (body: CatalogoDelIntegradorRequest) =>
        this.request<Ok<'integradorCatalogo.update'>>('/desarrollador/catalogo', {
          method: 'PUT',
          body,
        }),
    }
  }

  // ── La activación mayorista: lo que activa a cada cliente y paga en su ──
  //    canal (habilidad `desarrollador`; regla 4 del punto 12)

  get activaciones() {
    return {
      /**
       * `GET /desarrollador/tenants/{slug}/activaciones`: la base (su asiento),
       * los módulos y apps activos y lo que le cuestan al integrador al mes.
       */
      list: (tenantSlug: string) =>
        this.request<Ok<'integradorActivacion.index'>>(
          `/desarrollador/tenants/${encodeURIComponent(tenantSlug)}/activaciones`,
        ),
      /**
       * `POST /desarrollador/tenants/{slug}/activaciones`: activar la base, un
       * módulo o una app. La base es el asiento (la primera vez devuelve
       * `checkout_url`); un módulo o una app exigen la base viva y se cobran
       * al integrador como partida de su canal, sin prorrateo, en la factura
       * del mes. Idempotente (`already_active`). Es lo que llama el webhook del
       * integrador cuando su cliente le compra algo.
       */
      activate: (tenantSlug: string, body: ActivacionMayoristaRequest) =>
        this.request<Ok<'integradorActivacion.store'>>(
          `/desarrollador/tenants/${encodeURIComponent(tenantSlug)}/activaciones`,
          { method: 'POST', body },
        ),
      /**
       * `DELETE /desarrollador/tenants/{slug}/activaciones/{kind}/{item}`: dar de
       * baja. El módulo se apaga y deja de cobrarse; la app se desinstala de
       * todas las empresas; la base suelta el asiento.
       */
      deactivate: (tenantSlug: string, kind: 'base' | 'module' | 'app', item: string) =>
        this.request<Ok<'integradorActivacion.destroy'>>(
          `/desarrollador/tenants/${encodeURIComponent(tenantSlug)}/activaciones/${kind}/${encodeURIComponent(item)}`,
          { method: 'DELETE' },
        ),
    }
  }

  // ── Su login: el nombre que sirve en su servidor y reenvía al AS del ──
  //    ápice (habilidad `desarrollador`; regla 5 del punto 12, revisada el
  //    2026-09-07)

  get dominios() {
    return {
      /** `GET /desarrollador/dominios`: sus nombres de login, con el `upstream` y el bloque de proxy de cada uno. */
      list: () => this.request<Ok<'integradorDominio.index'>>('/desarrollador/dominios'),
      /**
       * `POST /desarrollador/dominios`: declarar el nombre público que el
       * integrador sirve (`host`, p. ej. `login.erpstudio.es`) y su etiqueta
       * interna (`slug`). Pimia no emite certificados ni toca DNS: devuelve
       * `upstream` (`https://login-<slug>.<central>`), a donde su proxy tiene
       * que reenviar con `Host` interno y el nombre público en
       * `X-Forwarded-Host`, y `proxy`, el bloque de Caddy listo para pegar.
       */
      declare: (body: IntegradorDominioRequest) =>
        this.request<Ok<'integradorDominio.store'>>('/desarrollador/dominios', {
          method: 'POST',
          body,
        }),
      /** `DELETE /desarrollador/dominios/{slug}`: retirar el nombre; el host interno deja de contestar. */
      remove: (slug: string) =>
        this.request<Ok<'integradorDominio.destroy'>>(
          `/desarrollador/dominios/${encodeURIComponent(slug)}`,
          { method: 'DELETE' },
        ),
    }
  }

  // ── Sus tokens de máquina (habilidad `desarrollador`; A3 cerrada) ───────

  get tokens() {
    return {
      /** `GET /desarrollador/tokens`: los tokens de máquina vivos (nunca los de una sesión del panel). */
      list: () => this.request<Ok<'integradorToken.index'>>('/desarrollador/tokens'),
      /**
       * `POST /desarrollador/tokens`: acuñar un token de máquina, acotado a la
       * habilidad `desarrollador` y nada más. El token en claro (`data.token`)
       * se devuelve UNA vez: guárdalo en tu servidor.
       */
      create: (body: IntegradorTokenRequest) =>
        this.request<Ok<'integradorToken.store'>>('/desarrollador/tokens', {
          method: 'POST',
          body,
        }),
      /** `DELETE /desarrollador/tokens/{id}`: revocarlo. */
      revoke: (id: number | string) =>
        this.request<Ok<'integradorToken.destroy'>>(`/desarrollador/tokens/${id}`, {
          method: 'DELETE',
        }),
    }
  }

  // ── Su cuenta de correo: desde dónde salen SUS invitaciones ─────────────
  //    (habilidad `desarrollador`; contrato 1.15.0, galeote/factSaas#831)

  get correo() {
    return {
      /**
       * `GET /desarrollador/correo`: la cuenta guardada, sin secretos
       * (`mail_password_set`, `mail_ses_secret_set`). `configured: false`
       * significa que lo suyo sale desde Pimia, y entonces el remitente es
       * `null`.
       */
      get: () => this.request<Ok<'integradorCorreo.show'>>('/desarrollador/correo'),
      /**
       * `PUT /desarrollador/correo`: guardarla. Una cuenta por integrador, para
       * todas sus verticales. 422 con `code: mail_host_not_allowed` si el
       * servidor no es público; el puerto, uno de 25, 465, 587 o 2525.
       *
       * ⚠️ Con la cuenta puesta, si el envío falla la invitación NO sale desde
       * Pimia: `invitations.create` responde 502 `integrator_mail_failed` y la
       * invitación no se crea.
       */
      update: (body: IntegradorCorreoRequest) =>
        this.request<Ok<'integradorCorreo.update'>>('/desarrollador/correo', {
          method: 'PUT',
          body,
        }),
      /** `DELETE /desarrollador/correo`: quitarla; lo suyo vuelve a salir desde Pimia. */
      delete: () =>
        this.request<Ok<'integradorCorreo.destroy'>>('/desarrollador/correo', { method: 'DELETE' }),
      /**
       * `POST /desarrollador/correo/prueba`: envía un correo con lo GUARDADO.
       * Contesta siempre 200: no lanza por un envío fallido, hay que mirar
       * `success` y, si es `false`, `error` y `reason`.
       */
      test: (body: CorreoPruebaRequest) =>
        this.request<CorreoPruebaResult>('/desarrollador/correo/prueba', { method: 'POST', body }),
    }
  }

  // ── Su Stripe propio: una cuenta independiente, sin Connect y sin tocar ──
  //    la facturación de Pimia (habilidad `desarrollador`; contrato 1.15.0)
  //
  //    El receptor `POST /stripe/integrador/{opaco}` está en el contrato pero
  //    NO aquí: lo llama Stripe, firmado, sin Bearer. Su URL es `webhook_url`.

  get stripe() {
    return {
      /**
       * `GET /desarrollador/stripe`: el estado de la vinculación (`linked`,
       * `mode`, la cuenta), sin secretos, y `webhook_url` + `webhook_events`
       * para dar de alta el endpoint a mano en Stripe.
       */
      get: () => this.request<Ok<'integradorStripe.show'>>('/desarrollador/stripe'),
      /**
       * `PUT /desarrollador/stripe`: validar en Stripe (`/v1/account` y
       * `/v1/balance`, solo lecturas) y guardar. Los cortes llegan con
       * `error.code` ∈ {@link StripeCorteCode}; nada se guarda en ellos.
       * Límite: 10 PUT/minuto y 5 fallos/hora.
       *
       * ⚠️ (1.16.0) Con suscripciones de clientes vivas, cambiar de cuenta o de
       * modo es un 409 `stripe_account_in_use`. Cambiarlos renueva
       * `webhook_url` y descarta el `whsec_` salvo que mandes uno nuevo.
       */
      update: (body: IntegradorStripeRequest) =>
        this.request<Ok<'integradorStripe.update'>>('/desarrollador/stripe', {
          method: 'PUT',
          body,
        }),
      /**
       * `DELETE /desarrollador/stripe`: desvincular y borrar los recibos
       * locales. Idempotente. No revoca claves ni borra el endpoint en Stripe;
       * una vinculación nueva tiene otra `webhook_url`. Con suscripciones de
       * clientes sin dar de baja, 409 `stripe_account_in_use` (1.16.0).
       */
      delete: () =>
        this.request<Ok<'integradorStripe.destroy'>>('/desarrollador/stripe', { method: 'DELETE' }),
    }
  }

  // ── La factura de lo que cobra a sus clientes: «Facturo con Pimia» ──────
  //    (habilidad `desarrollador`; contrato 1.16.0, galeote/factSaas#835 D)
  //
  //    Cada `invoice.paid` de una suscripción en SU Stripe deja un registro y,
  //    con el interruptor encendido, una factura en la instancia emisora que
  //    elija. Ni el Stripe de Pimia ni facturas de Stripe intervienen.

  get facturacionAClientes() {
    return {
      /**
       * `GET /desarrollador/facturacion-a-clientes`: `factura_con_pimia`,
       * `tenant_emisor_id`, `tipo_iva` (⚠️ decimal como TEXTO, `"21.00"`) y
       * `emisoras`, las instancias propias elegibles como `{ id, name }`. Por
       * defecto, apagado y al 21 %.
       */
      get: () =>
        this.request<Ok<'integradorFacturacionClientes.show'>>('/desarrollador/facturacion-a-clientes'),
      /**
       * `PUT /desarrollador/facturacion-a-clientes`: reemplaza los tres
       * ajustes. Una emisora que no es propia, activa y de producción es un 422
       * en `tenant_emisor_id`. Emisora e IVA se fijan al recibir cada pago:
       * cambiarlos no toca las facturas de cobros ya registrados.
       */
      update: (body: FacturacionAClientesRequest) =>
        this.request<Ok<'integradorFacturacionClientes.update'>>(
          '/desarrollador/facturacion-a-clientes',
          { method: 'PUT', body },
        ),
    }
  }

  get facturasAClientes() {
    return {
      /**
       * `GET /desarrollador/facturas-a-clientes`: UNA página (hasta 50, por id
       * ascendente) de los cobros propios con el estado de su factura. Para la
       * siguiente, pasa `cursor: page.next_cursor`; o usa {@link iterate}.
       */
      list: (query: FacturasAClientesQuery = {}) =>
        this.request<FacturasAClientesPage>('/desarrollador/facturas-a-clientes', {
          query: { estado: query.estado, cursor: query.cursor },
        }),
      /**
       * Recorre TODAS las páginas siguiendo `next_cursor`, fila a fila. Una
       * llamada por página, perezosa: si cortas el `for await`, no pide más.
       *
       * ```ts
       * for await (const f of central.facturasAClientes.iterate({ estado: 'error' })) {
       *   console.log(f.stripe_invoice, f.motivo)
       * }
       * ```
       */
      iterate: (query: FacturasAClientesQuery = {}) =>
        this.iterateFacturasAClientes(query),
      /**
       * `POST /desarrollador/facturas-a-clientes/{id}/reintentar`: vuelve a
       * encolar una fila en `error` o `pendiente_sin_nif`
       * ({@link FacturaAClienteReintentable}) tras corregir la causa. Si el
       * documento ya existía, completa lo pendiente sin crear otra factura.
       * Cualquier otro estado es un 409 (`PimiaApiError` con `status: 409`);
       * una fila de otro integrador, 404 (`NotFoundError`).
       * El núcleo contesta 202; el contrato lo publica como 200.
       */
      retry: (id: number | string) =>
        this.request<FacturaAClienteReintento>(
          `/desarrollador/facturas-a-clientes/${encodeURIComponent(String(id))}/reintentar`,
          { method: 'POST' },
        ),
    }
  }

  private async *iterateFacturasAClientes(
    query: FacturasAClientesQuery,
  ): AsyncGenerator<FacturaACliente, void, undefined> {
    let cursor = query.cursor
    const vistos = new Set<number>()
    while (true) {
      const page = await this.facturasAClientes.list({ estado: query.estado, cursor })
      yield* page.data
      if (page.next_cursor === null || page.next_cursor === undefined) return
      // Un cursor que no avanza sería un bucle infinito de peticiones.
      if (vistos.has(page.next_cursor)) return
      vistos.add(page.next_cursor)
      cursor = page.next_cursor
    }
  }

  // ── Lo que hace en el grupo compartido (habilidad `central`) ────────────

  get invitations() {
    return {
      list: () => this.request<Ok<'tenantInvitation.index'>>('/tenant-invitations'),
      /**
       * El cliente se registra y nace dueño; `billing` dice quién paga.
       * ⚠️ Si el integrador tiene su correo puesto (`correo.update`) y el envío
       * falla, responde 502 con `code: integrator_mail_failed` y la invitación
       * NO se crea: no sale desde Pimia en su lugar.
       */
      create: (body: TenantInvitationRequest) =>
        this.request<Ok<'tenantInvitation.store'>>('/tenant-invitations', { method: 'POST', body }),
      revoke: (id: number | string) =>
        this.request<Ok<'tenantInvitation.destroy'>>(`/tenant-invitations/${id}`, {
          method: 'DELETE',
        }),
    }
  }

  get billing() {
    return {
      /**
       * `POST /billing/portal` (1.4.0): la URL del portal de Stripe de la
       * cuenta del integrador —las facturas del canal y el método de pago
       * viven allí, no en Pimia—. 404 si la cuenta no tiene cliente de Stripe
       * todavía (nunca patrocinó a nadie).
       */
      portal: (body: BillingPortalRequest = {}) =>
        this.request<Ok<'billing.portal'>>('/billing/portal', { method: 'POST', body }),
    }
  }

  get sponsorship() {
    return {
      /** Asumir la licencia de un cliente: un asiento más en el plan de canal. */
      sponsor: (body: SponsorshipRequest) =>
        this.request<Ok<'billing.sponsor'>>('/billing/sponsorship', { method: 'POST', body }),
      /** Soltar un cliente patrocinado (queda en gracia y puede rescatarse). */
      release: (tenantSlug: string) =>
        this.request<Ok<'billing.releaseSponsorship'>>('/billing/sponsorship', {
          method: 'DELETE',
          body: { tenant_slug: tenantSlug },
        }),
    }
  }

  get tenants() {
    return {
      /**
       * `GET /tenants/{slug}/users` (1.4.0): quién pertenece a la instancia
       * —nombre, correo, rol, `is_owner`—. Es a quién se le puede traspasar:
       * `transferOwnership` pide el `user_id` de alguien que ya está dentro.
       */
      users: (slug: string) =>
        this.request<Ok<'tenant.users'>>(`/tenants/${encodeURIComponent(slug)}/users`),
      /** Traspasar la propiedad de la instancia a un usuario de la misma, antes de entregarla. */
      transferOwnership: (slug: string, body: TransferOwnershipRequest) =>
        this.request<Ok<'tenant.transferOwnership'>>(
          `/tenants/${encodeURIComponent(slug)}/transfer-ownership`,
          { method: 'POST', body },
        ),
    }
  }

  // ── Transporte ──────────────────────────────────────────────────────────

  async request<T = unknown>(path: string, options: CentralRequestOptions = {}): Promise<T> {
    const { data } = await this.requestWithMeta<T>(path, options)
    return data
  }

  async requestWithMeta<T = unknown>(
    path: string,
    options: CentralRequestOptions = {},
  ): Promise<CentralResponseWithMeta<T>> {
    const token = typeof this.token === 'function' ? await this.token() : this.token
    if (!token) {
      throw new NotAuthenticatedError(
        'No hay token personal: acuña uno en la cuenta de desarrollador antes de llamar al plano central.',
      )
    }

    const response = await this.doFetch(this.urlFor(path, options.query), {
      method: options.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...this.extraHeaders,
        ...options.headers,
        authorization: `Bearer ${token}`,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })

    const requestId = response.headers.get('x-request-id') ?? undefined
    const body = await parseBody(response)

    if (response.ok) {
      return { data: body as T, meta: { status: response.status, requestId } }
    }

    if (response.status === 429) {
      throw new RateLimitError(retryAfterSeconds(response), 429, 'Rate limit alcanzado', body, requestId)
    }

    throw PimiaApiError.from(response.status, body, requestId)
  }

  private urlFor(path: string, query: CentralRequestOptions['query']): string {
    const clean = path.replace(/^\/+/, '').replace(/^api\/?/, '')
    const url = new URL(`${this.baseUrl}/api/${clean}`)
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
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')
  if (raw === null) return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) ? seconds : undefined
}
