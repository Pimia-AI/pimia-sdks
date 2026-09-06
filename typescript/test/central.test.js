/**
 * El cliente del plano central con un `fetch` de mentira: la URL del ápice,
 * el bearer del token personal, y el contrato de errores de las habilidades
 * (galeote/factSaas#731), que es lo que distingue a este plano del de un
 * tenant.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ForbiddenError,
  MissingAbilityError,
  NotAuthenticatedError,
  PimiaCentralClient,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '../dist/index.js'

const BASE = 'https://pimia.es'

function clientWith(handler, options = {}) {
  const calls = []
  const client = new PimiaCentralClient({
    baseUrl: BASE + '/',
    token: 'pat-desarrollador',
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return handler(String(url), init, calls.length)
    },
    ...options,
  })
  return { client, calls }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

test('habla con el ápice bajo /api y manda el token personal como bearer', async () => {
  const { client, calls } = clientWith(() => json({ data: { cartera: [] } }))

  const data = await client.overview()

  assert.deepEqual(data, { data: { cartera: [] } })
  const [call] = calls
  assert.equal(call.url, `${BASE}/api/desarrollador/overview`)
  assert.equal(call.init.method, 'GET')
  assert.equal(call.init.headers.authorization, 'Bearer pat-desarrollador')
  assert.equal(call.init.headers.accept, 'application/json')
  assert.equal(call.init.body, undefined)
})

test('el token puede venir de una función, y sin token no llama', async () => {
  const { client, calls } = clientWith(() => json({ data: [] }), {
    token: async () => 'pat-leido-del-secreto',
  })
  await client.links.list()
  assert.equal(calls[0].init.headers.authorization, 'Bearer pat-leido-del-secreto')

  const sinToken = clientWith(() => json({}), { token: () => '' })
  await assert.rejects(() => sinToken.client.overview(), NotAuthenticatedError)
  assert.equal(sinToken.calls.length, 0)
})

test('las escrituras van como JSON a la ruta del contrato', async () => {
  const { client, calls } = clientWith(() => json({ message: 'ok', data: { checkout_url: null } }))

  await client.sponsorship.sponsor({ tenant_slug: 'talleres-ana', plan_id: 6 })
  await client.sponsorship.release('talleres-ana')
  await client.invitations.create({ email: 'ana@example.com', company_name: 'Talleres Ana', billing: 'sponsor' })
  await client.invitations.revoke(12)
  await client.tenants.transferOwnership('talleres ana', { user_id: 7 })
  await client.clients.claim({ client_id: 'mcp_x', client_secret: 'pcs_y' })
  await client.links.generateCode()
  await client.links.accept(3)

  const rutas = calls.map((c) => `${c.init.method} ${c.url.slice(BASE.length)}`)
  assert.deepEqual(rutas, [
    'POST /api/billing/sponsorship',
    'DELETE /api/billing/sponsorship',
    'POST /api/tenant-invitations',
    'DELETE /api/tenant-invitations/12',
    'POST /api/tenants/talleres%20ana/transfer-ownership',
    'POST /api/desarrollador/clients/claim',
    'POST /api/desarrollador/links/generate-code',
    'POST /api/desarrollador/links/3/accept',
  ])
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].init.body), { tenant_slug: 'talleres-ana', plan_id: 6 })
  assert.deepEqual(JSON.parse(calls[1].init.body), { tenant_slug: 'talleres-ana' })
  assert.equal(calls[6].init.headers['content-type'], undefined, 'sin cuerpo no hay content-type')
})

test('un 403 token_sin_habilidad es MissingAbilityError con la habilidad que falta', async () => {
  const { client } = clientWith(() =>
    json(
      {
        error: 'token_sin_habilidad',
        message: 'Esta credencial no alcanza este plano: le falta la habilidad «central».',
        required_ability: 'central',
      },
      403,
    ),
  )

  await assert.rejects(
    () => client.invitations.list(),
    (error) => {
      assert.ok(error instanceof MissingAbilityError)
      assert.ok(error instanceof ForbiddenError)
      assert.equal(error.ability, 'central')
      assert.equal(error.status, 403)
      return true
    },
  )
})

test('un 403 de figura sigue siendo ForbiddenError a secas, y el 401 de un token sin acotar, UnauthorizedError', async () => {
  const figura = clientWith(() => json({ message: 'Acceso solo para cuentas de desarrollador.' }, 403))
  await assert.rejects(
    () => figura.client.overview(),
    (error) => error instanceof ForbiddenError && !(error instanceof MissingAbilityError),
  )

  const sinAcotar = clientWith(() =>
    json({ error: 'token_sin_habilidades', message: 'Vuelve a entrar.' }, 401),
  )
  await assert.rejects(() => sinAcotar.client.overview(), UnauthorizedError)
  assert.equal(sinAcotar.calls.length, 1, 'no hay refresh que intentar: el token personal no rota')
})

test('422 y 429 llegan tipados como en el cliente del tenant', async () => {
  const invalido = clientWith(() =>
    json({ message: 'The given data was invalid.', errors: { email: ['obligatorio'] } }, 422),
  )
  await assert.rejects(
    () => invalido.client.invitations.create({ email: '', company_name: 'x', billing: 'self' }),
    (error) => error instanceof ValidationError && error.errors.email[0] === 'obligatorio',
  )

  const limitado = clientWith(() => json({ message: 'Too Many Attempts.' }, 429, { 'retry-after': '7' }))
  await assert.rejects(
    () => limitado.client.overview(),
    (error) => error instanceof RateLimitError && error.retryAfter === 7,
  )
})
