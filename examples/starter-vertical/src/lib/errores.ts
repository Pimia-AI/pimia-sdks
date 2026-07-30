/**
 * Traducción de errores de la API a mensajes de usuario, para las server
 * actions. Las dos clases que SIEMPRE hay que tratar:
 *
 *  - `MissingScopeError` (403): tu app no pidió ese permiso — el mensaje debe
 *    decir cuál y cómo arreglarlo, no «error inesperado»;
 *  - `ValidationError` (422): la validación es del SERVIDOR y viene por campo
 *    en `error.errors` — se enseña, no se traga.
 */

import { MissingScopeError, ValidationError } from '@pimia/sdk'

/**
 * `redirect()` de Next funciona lanzando una excepción: en un try/catch hay
 * que reconocerla y dejarla pasar.
 */
export function esRedirectDeNext(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const digest = (error as { digest?: string }).digest

  return error.message === 'NEXT_REDIRECT' || digest?.startsWith('NEXT_REDIRECT') === true
}

export function mensajeDeError(error: unknown): string {
  if (error instanceof MissingScopeError) {
    return `Tu app no tiene el permiso ${error.scope}. Añádelo a REQUESTED_SCOPES (y al registro del client) y vuelve a conectar.`
  }

  if (error instanceof ValidationError) {
    const detalle = Object.entries(error.errors)
      .map(([campo, mensajes]) => `${campo}: ${mensajes.join(', ')}`)
      .join(' · ')

    return detalle || error.message
  }

  return error instanceof Error ? error.message : 'Error inesperado'
}
