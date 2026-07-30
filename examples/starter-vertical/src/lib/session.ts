/**
 * Sesión del usuario EN TU APP. Es tuya, no de Pimia: aquí solo guardamos a qué
 * tenant está conectado y un id con el que localizar sus tokens en el servidor.
 *
 * Deliberadamente sin dependencias (HMAC de node:crypto) para que se lea de un
 * vistazo. En tu app real usa lo que ya tengas: NextAuth, iron-session, la
 * sesión de tu backend… lo único importante es que **los tokens de Pimia NO
 * viajan al navegador**.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

import { cookies } from 'next/headers'

import { config } from './config'

const COOKIE = 'pimia_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export interface Session {
  /** Id opaco: la clave con la que se guardan los tokens en el servidor. */
  sid: string
  /** Tenant al que está conectada esta sesión. */
  baseUrl: string
  createdAt: number
}

export function createSession(baseUrl: string): Session {
  return { sid: randomUUID(), baseUrl, createdAt: Date.now() }
}

export async function saveSession(session: Session): Promise<void> {
  const store = await cookies()

  store.set(COOKIE, sign(JSON.stringify(session)), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function readSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value

  if (!raw) return null

  const payload = verify(raw)
  if (payload === null) return null

  try {
    return JSON.parse(payload) as Session
  } catch {
    return null
  }
}

export async function clearSession(): Promise<void> {
  ;(await cookies()).delete(COOKIE)
}

/**
 * Guarda temporalmente el `code_verifier` de PKCE y el `state` mientras el
 * usuario está en la pantalla de consentimiento de Pimia. Cookie aparte y de
 * vida corta: en cuanto vuelve del callback se borra.
 */
const FLOW_COOKIE = 'pimia_flow'

export interface AuthFlow {
  verifier: string
  state: string
  baseUrl: string
}

export async function saveFlow(flow: AuthFlow): Promise<void> {
  const store = await cookies()

  store.set(FLOW_COOKIE, sign(JSON.stringify(flow)), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    maxAge: 10 * 60, // lo que dura el código de autorización
  })
}

export async function takeFlow(): Promise<AuthFlow | null> {
  const store = await cookies()
  const raw = store.get(FLOW_COOKIE)?.value
  store.delete(FLOW_COOKIE)

  if (!raw) return null

  const payload = verify(raw)

  return payload === null ? null : (JSON.parse(payload) as AuthFlow)
}

// ── Firma ────────────────────────────────────────────────────────────────────

function sign(payload: string): string {
  const body = Buffer.from(payload, 'utf8').toString('base64url')

  return `${body}.${hmac(body)}`
}

/** Devuelve el payload si la firma es válida; null si no. */
function verify(token: string): string | null {
  const [body, signature] = token.split('.')

  if (!body || !signature) return null

  const expected = Buffer.from(hmac(body))
  const received = Buffer.from(signature)

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null
  }

  return Buffer.from(body, 'base64url').toString('utf8')
}

function hmac(body: string): string {
  return createHmac('sha256', config.sessionSecret).update(body).digest('base64url')
}
