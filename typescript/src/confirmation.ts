import type { operations } from './api.js'
import type { operations as CentralOperations } from './central-api.js'

/** Cuerpo publicado por una operación para un estado HTTP concreto. */
export type ResponseBody<Operation, Status extends number> = Operation extends { responses: infer Responses }
  ? Status extends keyof Responses
    ? Responses[Status] extends { content: { 'application/json': infer Body } } ? Body : void
    : never
  : never

/** Incluye el 202: una escritura aceptada no implica una acción ejecutada. */
export type ApiSuccess<O extends keyof operations> = ResponseBody<operations[O], 200 | 201 | 202 | 204>
export type CentralSuccess<O extends keyof CentralOperations> = ResponseBody<CentralOperations[O], 200 | 201 | 202 | 204>

/** La acción espera el correo del dueño; data.id identifica la solicitud, no el recurso. */
export type OwnerConfirmationRequired = ResponseBody<operations['users.store'], 202>
export type OwnerConfirmationMailFailedCode = ResponseBody<operations['users.store'], 503>['code']
export type OwnerConfirmationResult<T> = T | OwnerConfirmationRequired

/** También acepta los cuerpos unknown de las peticiones genéricas; no ejecuta la acción. */
export function isOwnerConfirmationRequired(value: unknown): value is OwnerConfirmationRequired {
  if (!value || typeof value !== 'object') return false
  const body = value as Record<string, unknown>
  if (body.code !== 'owner_confirmation_required' || typeof body.message !== 'string') return false
  if (!body.data || typeof body.data !== 'object') return false
  const id = (body.data as Record<string, unknown>).id
  return typeof id === 'number' && Number.isInteger(id)
}
