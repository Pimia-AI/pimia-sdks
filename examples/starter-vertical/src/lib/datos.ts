/**
 * Lectura de listas y detalles con la política de errores de la casa:
 *
 *  - un **403 por scope no es un fallo**: es que esta app no pidió ese
 *    permiso. Se devuelve `missingScope` y la página lo enseña con la
 *    instrucción de arreglo, en vez de un error 500 opaco;
 *  - cualquier otro error SÍ revienta: que lo vea el desarrollador.
 *
 * Las listas de la API vienen paginadas al estilo Laravel:
 * `{ data: [...], meta: { current_page, last_page, total, per_page } }`.
 */

import { MissingScopeError, NotFoundError } from '@pimia/sdk'

import { callApi } from './pimia'

export interface MetaPagina {
  current_page: number
  last_page: number
  total: number
  per_page: number
}

export interface Listado<T> {
  rows: T[]
  meta: MetaPagina | null
  missingScope?: string
}

export async function listar<T>(fn: () => Promise<unknown>): Promise<Listado<T>> {
  try {
    const response = (await callApi(fn)) as { data?: unknown; meta?: MetaPagina } | unknown[]

    if (Array.isArray(response)) return { rows: response as T[], meta: null }

    const data = response?.data

    return {
      rows: Array.isArray(data) ? (data as T[]) : [],
      meta: response?.meta ?? null,
    }
  } catch (error) {
    if (error instanceof MissingScopeError) {
      return { rows: [], meta: null, missingScope: error.scope }
    }

    throw error
  }
}

export interface Detalle<T> {
  data: T | null
  missingScope?: string
  /** true si la API respondió 404: el recurso no existe (o no es tuyo). */
  notFound?: boolean
}

export async function detalle<T>(fn: () => Promise<unknown>): Promise<Detalle<T>> {
  try {
    const response = (await callApi(fn)) as { data?: T } | T

    const data =
      response !== null && typeof response === 'object' && 'data' in (response as object)
        ? ((response as { data?: T }).data ?? null)
        : (response as T)

    return { data }
  } catch (error) {
    if (error instanceof MissingScopeError) {
      return { data: null, missingScope: error.scope }
    }
    if (error instanceof NotFoundError) {
      return { data: null, notFound: true }
    }

    throw error
  }
}
