/** Tests de la ceremonia OAuth: PKCE, URL de authorize, canje y revocación. */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import { OAuth, OAuthError, createPkceChallenge, createState } from '../dist/index.js'

const BASE = 'https://acme.pimia.es'

function oauthWith(handler) {
  const calls = []

  const oauth = new OAuth({
    baseUrl: `${BASE}/`, // con barra final: debe normalizarse
    clientId: 'mcp_test',
    clientSecret: 'pcs_test',
    redirectUri: 'https://partner.example/cb',
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return handler(String(url), init)
    },
  })

  return { oauth, calls }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('el challenge PKCE es el SHA-256 base64url del verifier', async () => {
  const pkce = await createPkceChallenge()

  const expected = createHash('sha256')
    .update(pkce.verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  assert.equal(pkce.method, 'S256')
  assert.equal(pkce.challenge, expected)
  assert.ok(pkce.verifier.length >= 43) // mínimo de RFC 7636
  assert.doesNotMatch(pkce.challenge, /[+/=]/)
})

test('dos challenges (y dos states) no se repiten', async () => {
  const [a, b] = await Promise.all([createPkceChallenge(), createPkceChallenge()])

  assert.notEqual(a.verifier, b.verifier)
  assert.notEqual(createState(), createState())
})

test('la URL de authorize lleva todos los parámetros y normaliza la base', async () => {
  const { oauth } = oauthWith(() => json({}))
  const pkce = await createPkceChallenge()

  const url = new URL(
    oauth.buildAuthorizeUrl({
      scopes: ['invoices:read', 'customers:read'],
      state: 'st4te',
      pkce,
    }),
  )

  assert.equal(url.origin + url.pathname, `${BASE}/oauth/authorize`)
  assert.equal(url.searchParams.get('client_id'), 'mcp_test')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('scope'), 'invoices:read customers:read')
  assert.equal(url.searchParams.get('state'), 'st4te')
  assert.equal(url.searchParams.get('code_challenge'), pkce.challenge)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://partner.example/cb')
})

test('el canje manda code_verifier y el secret del client confidencial', async () => {
  const { oauth, calls } = oauthWith(() =>
    json({
      access_token: 'at-1',
      refresh_token: 'prt-1',
      expires_in: 86400,
      scope: 'invoices:read',
      token_type: 'bearer',
    }),
  )

  const pkce = await createPkceChallenge()
  const before = Date.now()
  const tokens = await oauth.exchangeCode('c0de', pkce)

  const body = new URLSearchParams(calls[0].init.body)
  assert.equal(calls[0].url, `${BASE}/oauth/token`)
  assert.equal(body.get('grant_type'), 'authorization_code')
  assert.equal(body.get('code'), 'c0de')
  assert.equal(body.get('code_verifier'), pkce.verifier)
  assert.equal(body.get('client_secret'), 'pcs_test')
  assert.equal(body.get('redirect_uri'), 'https://partner.example/cb')

  assert.equal(tokens.accessToken, 'at-1')
  assert.equal(tokens.refreshToken, 'prt-1')
  assert.ok(tokens.expiresAt >= before + 86400 * 1000)
})

test('un error del token endpoint llega como OAuthError con su código', async () => {
  const { oauth } = oauthWith(() =>
    json({ error: 'invalid_client', error_description: 'Client authentication failed' }, 401),
  )

  await assert.rejects(
    () => oauth.refresh('prt-1'),
    (error) => {
      assert.ok(error instanceof OAuthError)
      assert.equal(error.error, 'invalid_client')
      assert.match(error.message, /Client authentication failed/)
      return true
    },
  )
})

test('sin refresh_token en la respuesta (kill-switch del operador) no se inventa uno', async () => {
  const { oauth } = oauthWith(() => json({ access_token: 'at-1', token_type: 'bearer' }))

  const tokens = await oauth.exchangeCode('c0de', await createPkceChallenge())

  assert.equal(tokens.refreshToken, undefined)
  assert.equal(tokens.expiresAt, undefined)
})

test('revoke usa el endpoint RFC 7009 y tolera el 200 mudo', async () => {
  const { oauth, calls } = oauthWith(() => new Response('', { status: 200 }))

  await oauth.revoke('prt-1')

  const body = new URLSearchParams(calls[0].init.body)
  assert.equal(calls[0].url, `${BASE}/oauth/revoke`)
  assert.equal(body.get('token'), 'prt-1')
  assert.equal(body.get('client_id'), 'mcp_test')
})

test('la metadata del AS se lee del well-known', async () => {
  const { oauth, calls } = oauthWith(() =>
    json({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/oauth/token`,
      revocation_endpoint: `${BASE}/oauth/revoke`,
      scopes_supported: ['invoices:read'],
    }),
  )

  const metadata = await oauth.metadata()

  assert.equal(calls[0].url, `${BASE}/.well-known/oauth-authorization-server`)
  assert.equal(metadata.revocation_endpoint, `${BASE}/oauth/revoke`)
})
