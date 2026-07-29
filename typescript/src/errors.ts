/**
 * Errores del SDK. La API de Pimia tiene un contrato de errores estable
 * (docs/guia-integradores.md §7) y merece tipos propios: un 403 por scope no
 * se arregla reintentando, un 422 tampoco, y un 429 sí.
 */

export class PimiaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** Respuesta HTTP de error de la API. */
export class PimiaApiError extends PimiaError {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
    readonly requestId?: string,
  ) {
    super(message)
  }

  static from(status: number, body: unknown, requestId?: string): PimiaApiError {
    const message = messageFrom(body) ?? `HTTP ${status}`

    if (status === 401) return new UnauthorizedError(status, message, body, requestId)
    if (status === 403) {
      const scope = scopeFrom(message)
      if (scope) return new MissingScopeError(scope, status, message, body, requestId)
      return new ForbiddenError(status, message, body, requestId)
    }
    if (status === 422) return new ValidationError(status, message, body, requestId)
    if (status === 404) return new NotFoundError(status, message, body, requestId)

    return new PimiaApiError(status, message, body, requestId)
  }
}

/**
 * 401: el access token no vale (caducado, revocado o el usuario retiró el
 * acceso desde Ajustes → Apps conectadas). El cliente intenta refrescar una
 * vez por su cuenta; si vuelve a salir, hay que re-autorizar al usuario.
 */
export class UnauthorizedError extends PimiaApiError {}

export class ForbiddenError extends PimiaApiError {}

/**
 * 403 del api-guard: al token le falta un scope. `scope` viene parseado del
 * mensaje («Token lacks the invoices:write scope») para que el partner sepa
 * exactamente qué pedir en el próximo authorize.
 */
export class MissingScopeError extends ForbiddenError {
  constructor(
    readonly scope: string,
    status: number,
    message: string,
    body: unknown,
    requestId?: string,
  ) {
    super(status, message, body, requestId)
  }
}

export class NotFoundError extends PimiaApiError {}

/** 422: validación de negocio. `errors` es el mapa campo → mensajes. */
export class ValidationError extends PimiaApiError {
  get errors(): Record<string, string[]> {
    const body = this.body as { errors?: Record<string, string[]> } | null
    return body?.errors ?? {}
  }
}

/** 429: pasado el rate limit. `retryAfter` en segundos si la API lo dijo. */
export class RateLimitError extends PimiaApiError {
  constructor(
    readonly retryAfter: number | undefined,
    status: number,
    message: string,
    body: unknown,
    requestId?: string,
  ) {
    super(status, message, body, requestId)
  }
}

/** Error del flujo OAuth (token endpoint, revocación). */
export class OAuthError extends PimiaError {
  constructor(
    readonly error: string,
    readonly description?: string,
  ) {
    super(description ? `${error}: ${description}` : error)
  }
}

/**
 * No hay tokens con los que trabajar (o se perdieron). Distinto de un 401:
 * aquí ni se intentó la llamada.
 */
export class NotAuthenticatedError extends PimiaError {}

function messageFrom(body: unknown): string | undefined {
  if (typeof body === 'string' && body !== '') return body
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    for (const key of ['message', 'error_description', 'error']) {
      if (typeof record[key] === 'string' && record[key] !== '') return record[key] as string
    }
  }
  return undefined
}

/** «Token lacks the invoices:write scope» → `invoices:write`. */
function scopeFrom(message: string): string | undefined {
  return /Token lacks the (\S+) scope/.exec(message)?.[1]
}
