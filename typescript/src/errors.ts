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
    if (status === 422) {
      const duplicate = duplicateExternalRefFrom(body)
      if (duplicate) {
        return new DuplicateExternalRefError(
          duplicate.existingId,
          duplicate.externalRef,
          duplicate.entityType,
          status,
          message,
          body,
          requestId,
        )
      }
      return new ValidationError(status, message, body, requestId)
    }
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

/**
 * 422 `external_ref_already_used`: la referencia externa que intentaste colgar
 * ya la lleva otro recurso del mismo tipo dentro de tu namespace (company +
 * client OAuth).
 *
 * **Lo normal es que no sea un error tuyo, sino tu reintento**: «crea el cliente
 * del deal 42» ejecutado dos veces porque el proceso se cayó entre el POST y el
 * guardado de tu mapeo. Por eso el error trae {@link existingId}, el recurso que
 * ya lleva esa referencia — que es lo que convierte el choque en un
 * find-or-create sin mantener ningún mapeo local:
 *
 * ```ts
 * async function clienteDelDeal(dealId: string, name: string): Promise<number> {
 *   try {
 *     const { id } = await crearCliente({ name, external_ref: `deal_${dealId}` })
 *     return id
 *   } catch (error) {
 *     // Ya existía: el propio error dice cuál es.
 *     if (error instanceof DuplicateExternalRefError) return error.existingId
 *     throw error
 *   }
 * }
 * ```
 *
 * Hereda de {@link ValidationError} a propósito: el cuerpo trae también el
 * `errors` de siempre, así que el código que ya trataba los 422 por ese camino
 * sigue funcionando sin ramas nuevas.
 */
export class DuplicateExternalRefError extends ValidationError {
  constructor(
    /** Id del recurso que YA lleva esa referencia. Tu find-or-create acaba aquí. */
    readonly existingId: number,
    /** La referencia que chocó, tal y como la mandaste. */
    readonly externalRef: string,
    /** Tipo del recurso en el core (`customer`, `estimate`, `invoice`). */
    readonly entityType: string,
    status: number,
    message: string,
    body: unknown,
    requestId?: string,
  ) {
    super(status, message, body, requestId)
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

/**
 * Reconoce el 422 de referencia duplicada por su campo `error`, no por la prosa
 * del mensaje —que está en castellano y puede cambiar—. Sin `existing_id` usable
 * no se promueve el error: sin ese id no hay find-or-create que hacer, y un
 * {@link ValidationError} normal describe mejor lo que pasó.
 */
function duplicateExternalRefFrom(
  body: unknown,
): { existingId: number; externalRef: string; entityType: string } | undefined {
  if (!body || typeof body !== 'object') return undefined

  const record = body as Record<string, unknown>
  if (record.error !== 'external_ref_already_used') return undefined

  // El core lo manda como entero; se normaliza igualmente porque en este
  // contrato hay enteros que llegan como cadena según el driver. Ojo con
  // `Number(null)`, que es 0 y no NaN: sin descartar antes los no-numéricos, un
  // `existing_id: null` se colaría como el id 0.
  const raw = record.existing_id
  const existingId =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN
  if (!Number.isInteger(existingId)) return undefined

  return {
    existingId,
    externalRef: typeof record.external_ref === 'string' ? record.external_ref : '',
    entityType: typeof record.entity_type === 'string' ? record.entity_type : '',
  }
}

/** «Token lacks the invoices:write scope» → `invoices:write`. */
function scopeFrom(message: string): string | undefined {
  return /Token lacks the (\S+) scope/.exec(message)?.[1]
}
