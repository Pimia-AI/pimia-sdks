/**
 * Fábrica del cliente de Pimia para la petición en curso. Todo lo de aquí es
 * de SERVIDOR: el client_secret y los tokens no salen de este proceso.
 */

import { redirect } from 'next/navigation'

import { OAuth, PimiaClient, UnauthorizedError } from '@pimia/sdk'

import { config } from './config'
import { readSession, type Session } from './session'
import { FileTokenStore } from './tokens'

/** Marca de «hay que volver a autorizar»: la usan las páginas para redirigir. */
export class NeedsAuthorization extends Error {}

function baseConfig(baseUrl: string) {
  return {
    baseUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  }
}

export function oauthFor(baseUrl: string): OAuth {
  return new OAuth(baseConfig(baseUrl))
}

export function clientFor(session: Session): PimiaClient {
  return new PimiaClient({
    ...baseConfig(session.baseUrl),
    tokens: new FileTokenStore(session.sid),
    // Un User-Agent propio ayuda a que el operador identifique tu app en sus
    // logs y en la pantalla de apps conectadas del usuario.
    headers: { 'user-agent': 'pimia-starter-vertical/0.1' },
  })
}

/**
 * Sesión + cliente listos, o `NeedsAuthorization` si no hay sesión. Las páginas
 * lo usan y redirigen a /login cuando salta.
 */
export async function requireClient(): Promise<{ session: Session; pimia: PimiaClient }> {
  const session = await readSession()

  if (!session) throw new NeedsAuthorization('sin sesión')

  return { session, pimia: clientFor(session) }
}

/**
 * Igual que `requireClient`, pero para páginas: sin sesión, a la portada a
 * repetir la autorización. Así cada página no repite el mismo try/catch.
 */
export async function clienteOPortada(): Promise<{ session: Session; pimia: PimiaClient }> {
  try {
    return await requireClient()
  } catch (error) {
    if (error instanceof NeedsAuthorization) redirect('/?error=flujo_incompleto')
    throw error
  }
}

/**
 * Envuelve una llamada a la API y convierte el «token muerto» en algo que la
 * UI entiende. Recuerda: si el SDK lanza UnauthorizedError, ya intentó
 * refrescar y falló — el usuario revocó tu app o el grant caducó, así que toca
 * repetir el consentimiento (no reintentar).
 */
export async function callApi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw new NeedsAuthorization(error.message)
    }

    throw error
  }
}
