/**
 * GET /callback — vuelta de la pantalla de consentimiento.
 *
 * Tres cosas, en este orden y sin saltarse ninguna:
 *   1. si el usuario dijo que no, Pimia devuelve `error` y no hay code;
 *   2. el `state` tiene que ser el que mandamos (anti-CSRF);
 *   3. se canjea el código con el `code_verifier` de PKCE y se guardan los
 *      tokens EN EL SERVIDOR, nunca en el navegador.
 */

import { NextResponse } from 'next/server'

import { config } from '@/lib/config'
import { oauthFor } from '@/lib/pimia'
import { createSession, saveSession, takeFlow } from '@/lib/session'
import { FileTokenStore } from '@/lib/tokens'

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams
  const flow = await takeFlow()

  const denied = params.get('error')
  if (denied) {
    return NextResponse.redirect(`${config.appUrl}/?error=${encodeURIComponent(denied)}`)
  }

  const code = params.get('code')
  if (!code || !flow) {
    return NextResponse.redirect(`${config.appUrl}/?error=flujo_incompleto`)
  }

  if (params.get('state') !== flow.state) {
    // Alguien intentó colarnos un callback ajeno.
    return NextResponse.redirect(`${config.appUrl}/?error=state_invalido`)
  }

  try {
    // Solo hace falta el verifier: lo guardamos en la cookie del flujo antes
    // de mandar al usuario al consentimiento.
    const tokens = await oauthFor(flow.baseUrl).exchangeCode(code, { verifier: flow.verifier })

    const session = createSession(flow.baseUrl)
    await new FileTokenStore(session.sid).save(tokens)
    await saveSession(session)

    return NextResponse.redirect(`${config.appUrl}/panel`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'canje_fallido'

    return NextResponse.redirect(`${config.appUrl}/?error=${encodeURIComponent(reason)}`)
  }
}
