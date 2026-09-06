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

/** Cuerpo de `POST /billing/sponsorship`: la instancia y el plan de canal con que se paga. */
export type SponsorshipRequest = Body<'billing.sponsor'>
/** Cuerpo de `POST /tenant-invitations`: a quién se invita y quién paga (`billing`). */
export type TenantInvitationRequest = Body<'tenantInvitation.store'>
/** Cuerpo de `POST /tenants/{slug}/transfer-ownership`: el usuario de la instancia que pasa a ser dueño. */
export type TransferOwnershipRequest = Body<'tenant.transferOwnership'>
/**
 * Cuerpo de `PUT /desarrollador/catalogo`: el catálogo del integrador ENTERO —
 * cabecera (nombre comercial, soporte, moneda ISO 4217, enlace de contratación)
 * y filas (`kind` ∈ `base|module|app`, `slug`, `price_cents` en subunidades de
 * esa moneda, `contract_url` propio opcional, `enabled`)—. Lo que no venga deja
 * de existir.
 */
export type CatalogoDelIntegradorRequest = Body<'integradorCatalogo.update'>
/**
 * Cuerpo de `POST /desarrollador/tenants/{slug}/activaciones`: qué se activa al
 * cliente (`kind` ∈ `base|module|app`, `slug`; `plan_id` solo si hay varios
 * planes de canal).
 */
export type ActivacionMayoristaRequest = Body<'integradorActivacion.store'>

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

  // ── Lo que hace en el grupo compartido (habilidad `central`) ────────────

  get invitations() {
    return {
      list: () => this.request<Ok<'tenantInvitation.index'>>('/tenant-invitations'),
      /** El cliente se registra y nace dueño; `billing` dice quién paga. */
      create: (body: TenantInvitationRequest) =>
        this.request<Ok<'tenantInvitation.store'>>('/tenant-invitations', { method: 'POST', body }),
      revoke: (id: number | string) =>
        this.request<Ok<'tenantInvitation.destroy'>>(`/tenant-invitations/${id}`, {
          method: 'DELETE',
        }),
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
