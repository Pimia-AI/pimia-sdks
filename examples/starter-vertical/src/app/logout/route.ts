/**
 * POST /logout — cerrar sesión y, de paso, ser buen ciudadano.
 *
 * Revoca el refresh token en Pimia (RFC 7009): eso tumba el grant entero, así
 * que tu app desaparece de «Apps conectadas» del usuario y no deja tokens
 * vivos por ahí. Si solo borras tu cookie, el acceso sigue concedido.
 */

import { NextResponse } from 'next/server'

import { config } from '@/lib/config'
import { oauthFor } from '@/lib/pimia'
import { clearSession, readSession } from '@/lib/session'
import { FileTokenStore } from '@/lib/tokens'

export async function POST(): Promise<NextResponse> {
  const session = await readSession()

  if (session) {
    const store = new FileTokenStore(session.sid)
    const tokens = await store.load()

    if (tokens?.refreshToken) {
      // Best-effort: si Pimia no está disponible, la sesión local se cierra
      // igual (y el token morirá por su expires_at).
      await oauthFor(session.baseUrl)
        .revoke(tokens.refreshToken)
        .catch(() => undefined)
    }

    await store.clear()
    await clearSession()
  }

  return NextResponse.redirect(`${config.appUrl}/`, { status: 303 })
}
