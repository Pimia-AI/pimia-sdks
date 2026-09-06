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

test('el catálogo del integrador: leerlo y reemplazarlo entero por la ruta del contrato', async () => {
  const { client, calls } = clientWith(() =>
    json({ data: { perfil: null, currency: null, contract_url: null, items: [], disponibles: { base: [], modules: [], apps: [] } } }),
  )

  const leido = await client.catalogo.get()
  assert.equal(leido.data.perfil, null)

  await client.catalogo.replace({
    nombre_comercial: 'Zoomo Estudio',
    currency: 'EUR',
    contract_url: 'https://app.erpstudio.es/contratar',
    items: [
      { kind: 'base', slug: 'pimia', price_cents: 2900 },
      { kind: 'module', slug: 'crm', price_cents: 500 },
    ],
  })

  assert.deepEqual(
    calls.map((c) => `${c.init.method} ${c.url.slice(BASE.length)}`),
    ['GET /api/desarrollador/catalogo', 'PUT /api/desarrollador/catalogo'],
  )
  assert.equal(calls[1].init.headers['content-type'], 'application/json')
  assert.equal(JSON.parse(calls[1].init.body).items.length, 2)
})

test('la activación mayorista: listar, activar y dar de baja por la ruta del contrato', async () => {
  const { client, calls } = clientWith((url, init) =>
    json(
      init.method === 'POST'
        ? { message: 'Activado', data: { already_active: false, checkout_url: null, quantity: 1, activation: { kind: 'module', slug: 'crm' } } }
        : { data: { base: { active: true }, items: [], total_cents: 4900, total: '49,00 €' } },
      init.method === 'POST' ? 201 : 200,
    ),
  )

  const lista = await client.activaciones.list('talleres ana')
  assert.equal(lista.data.base.active, true)

  const alta = await client.activaciones.activate('talleres-ana', { kind: 'module', slug: 'crm' })
  assert.equal(alta.data.quantity, 1)

  await client.activaciones.deactivate('talleres-ana', 'module', 'crm')
  await client.activaciones.activate('talleres-ana', { kind: 'base', slug: 'pimia', plan_id: 6 })

  assert.deepEqual(
    calls.map((c) => `${c.init.method} ${c.url.slice(BASE.length)}`),
    [
      'GET /api/desarrollador/tenants/talleres%20ana/activaciones',
      'POST /api/desarrollador/tenants/talleres-ana/activaciones',
      'DELETE /api/desarrollador/tenants/talleres-ana/activaciones/module/crm',
      'POST /api/desarrollador/tenants/talleres-ana/activaciones',
    ],
  )
  assert.deepEqual(JSON.parse(calls[1].init.body), { kind: 'module', slug: 'crm' })
  assert.deepEqual(JSON.parse(calls[3].init.body), { kind: 'base', slug: 'pimia', plan_id: 6 })
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

test('declara y retira sus nombres de login, y acuña y revoca tokens de máquina', async () => {
  const { client, calls } = clientWith((url, init) => {
    if (url.endsWith('/desarrollador/dominios') && init.method === 'POST') {
      return json(
        {
          message: 'Nombre declarado.',
          data: {
            slug: 'zoomo',
            host: 'login.erpstudio.es',
            enabled: true,
            login_url: 'https://login.erpstudio.es',
            upstream: 'https://login-zoomo.pimia.es',
            proxy: 'login.erpstudio.es {\n    reverse_proxy https://login-zoomo.pimia.es { … }\n}',
            created_at: null,
          },
        },
        201,
      )
    }
    if (url.endsWith('/desarrollador/tokens') && init.method === 'POST') {
      return json({ message: 'Token creado.', data: { token: '12|abc', id: 12, name: 'webhook', abilities: ['desarrollador'] } }, 201)
    }
    return json({ message: 'ok' })
  })

  const declarado = await client.dominios.declare({ slug: 'zoomo', host: 'login.erpstudio.es' })
  assert.equal(declarado.data.upstream, 'https://login-zoomo.pimia.es')
  assert.match(declarado.data.proxy, /reverse_proxy/)

  await client.dominios.remove('zoomo')
  const acunado = await client.tokens.create({ name: 'webhook' })
  assert.equal(acunado.data.token, '12|abc')
  await client.tokens.revoke(12)
  await client.dominios.list()
  await client.tokens.list()

  assert.deepEqual(
    calls.map((c) => [c.init.method, c.url.replace(BASE, '')]),
    [
      ['POST', '/api/desarrollador/dominios'],
      ['DELETE', '/api/desarrollador/dominios/zoomo'],
      ['POST', '/api/desarrollador/tokens'],
      ['DELETE', '/api/desarrollador/tokens/12'],
      ['GET', '/api/desarrollador/dominios'],
      ['GET', '/api/desarrollador/tokens'],
    ],
  )
  assert.equal(JSON.parse(calls[0].init.body).host, 'login.erpstudio.es')
})
