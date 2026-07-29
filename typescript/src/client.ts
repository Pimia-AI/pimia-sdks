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

import {
  NotAuthenticatedError,
  PimiaApiError,
  RateLimitError,
  UnauthorizedError,
} from './errors.js'
import { OAuth, type OAuthConfig } from './oauth.js'
import { isExpired, type TokenSet, type TokenStore } from './tokens.js'

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

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Query string. Los `undefined`/`null` se omiten; los arrays se repiten. */
  query?: Record<string, string | number | boolean | undefined | null | Array<string | number>>
  /** Cuerpo JSON. */
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

/** Cabeceras de rate limit que devuelve la API en cada respuesta. */
export interface RateLimit {
  limit?: number
  remaining?: number
}

export class PimiaClient {
  readonly oauth: OAuth
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
    this.oauth = new OAuth(options)
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.doFetch = options.fetch ?? globalThis.fetch
    this.store = options.tokens
    this.skew = options.expirySkewSeconds ?? 60
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 2
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 30_000
    this.extraHeaders = options.headers ?? {}
  }

  /** Cabeceras `X-RateLimit-*` de la última respuesta. */
  get rateLimit(): RateLimit {
    return { ...this.lastRateLimit }
  }

  get invoices() {
    return {
      list: (query?: RequestOptions['query']) => this.get('/invoices', query),
      get: (id: number | string) => this.get(`/invoices/${id}`),
      create: (body: unknown) => this.post('/invoices', body),
      update: (id: number | string, body: unknown) => this.put(`/invoices/${id}`, body),
    }
  }

  get customers() {
    return {
      list: (query?: RequestOptions['query']) => this.get('/customers', query),
      get: (id: number | string) => this.get(`/customers/${id}`),
      create: (body: unknown) => this.post('/customers', body),
      update: (id: number | string, body: unknown) => this.put(`/customers/${id}`, body),
    }
  }

  get estimates() {
    return {
      list: (query?: RequestOptions['query']) => this.get('/estimates', query),
      get: (id: number | string) => this.get(`/estimates/${id}`),
      create: (body: unknown) => this.post('/estimates', body),
    }
  }

  get<T = unknown>(path: string, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>(path, { method: 'GET', query })
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body })
  }

  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body })
  }

  patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body })
  }

  delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' })
  }

  /**
   * Petición cruda contra `/api/v1`. `path` puede llevar el prefijo o no:
   * `/invoices` y `/api/v1/invoices` son lo mismo.
   */
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
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
          accept: 'application/json',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...this.extraHeaders,
          ...options.headers,
          authorization: `Bearer ${tokens.accessToken}`,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      })

      this.captureRateLimit(response)

      if (response.ok) {
        return (await parseBody(response)) as T
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

    if (!current.refreshToken) {
      throw new UnauthorizedError(
        401,
        'El access token caducó y no hay refresh token: vuelve a pedir autorización al usuario.',
        null,
      )
    }

    this.refreshing = (async () => {
      try {
        const rotated = await this.oauth.refresh(current.refreshToken!)
        await this.store.save(rotated)

        return rotated
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
