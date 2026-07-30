/**
 * Paso 1 de la demo e2e: construir la URL de autorización con el SDK.
 *
 *   node authorize.mjs
 *
 * Guarda el `verifier` y el `state` en /tmp para el paso 2 (es lo que una app
 * real guardaría en la sesión del usuario).
 */

import { writeFileSync } from 'node:fs'

import { OAuth, SCOPES, createPkceChallenge, createState } from '@pimia/sdk'

const client = JSON.parse(process.env.PIMIA_CLIENT_JSON ?? '{}')

const oauth = new OAuth({
  baseUrl: process.env.PIMIA_BASE_URL,
  clientId: client.client_id,
  clientSecret: client.client_secret,
  redirectUri: client.redirect_uris[0],
})

// La metadata la sirve el propio AS: sin cablear rutas a mano.
const metadata = await oauth.metadata()
console.log('issuer:', metadata.issuer)
console.log('scopes que anuncia el AS:', metadata.scopes_supported.length)

const pkce = await createPkceChallenge()
const state = createState()

writeFileSync('/tmp/pimia-e2e-session.json', JSON.stringify({ verifier: pkce.verifier, state }))

console.log('\nAbre esta URL y pulsa Autorizar:\n')
console.log(
  oauth.buildAuthorizeUrl({
    scopes: [SCOPES.invoicesRead, SCOPES.customersRead],
    state,
    pkce,
  }),
)
