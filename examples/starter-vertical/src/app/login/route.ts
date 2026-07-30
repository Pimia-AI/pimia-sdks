/**
 * GET /login — arranca la autorización.
 *
 * Genera PKCE + state, los guarda en una cookie httpOnly de vida corta y manda
 * al usuario a la pantalla de consentimiento de SU tenant.
 *
 * `?tenant=https://otro.pimia.es` permite elegir tenant: en Pimia un token
 * vale para un solo tenant, así que una app que sirve a varios clientes tiene
 * que resolver esto por usuario (aquí, a mano; en tu app, por su alta).
 */

import { createPkceChallenge, createState } from '@pimia/sdk'
import { NextResponse } from 'next/server'

import { config, REQUESTED_SCOPES } from '@/lib/config'
import { oauthFor } from '@/lib/pimia'
import { saveFlow } from '@/lib/session'

export async function GET(request: Request): Promise<NextResponse> {
  const requested = new URL(request.url).searchParams.get('tenant')
  const baseUrl = (requested ?? config.defaultBaseUrl).replace(/\/+$/, '')

  // Un `tenant` de la query es entrada del usuario: solo https, y nada de
  // redirigir a un host cualquiera.
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(baseUrl)) {
    return NextResponse.json({ error: 'tenant inválido' }, { status: 400 })
  }

  const pkce = await createPkceChallenge()
  const state = createState()

  await saveFlow({ verifier: pkce.verifier, state, baseUrl })

  return NextResponse.redirect(
    oauthFor(baseUrl).buildAuthorizeUrl({
      scopes: [...REQUESTED_SCOPES],
      state,
      pkce,
    }),
  )
}
