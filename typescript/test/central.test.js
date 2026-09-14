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
  NotFoundError,
  PimiaApiError,
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

  // Desde el contrato 1.9.0, sin cabecera de marca: eso es de cada vertical.
  await client.catalogo.replace({
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

  const declarado = await client.dominios.declare({ slug: 'zoomo', host: 'login.erpstudio.es', vertical: 'talleres' })
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

test('1.4.0: quién pertenece a la instancia y el portal del canal', async () => {
  const { client, calls } = clientWith((url) =>
    url.endsWith('/users')
      ? json({ data: [{ id: 7, name: 'Ana', email: 'ana@example.test', role: 'admin', is_owner: false }] })
      : json({ data: { portal_url: 'https://billing.stripe.test/p' } }),
  )

  const usuarios = await client.tenants.users('talleres ana')
  assert.equal(usuarios.data[0].name, 'Ana')
  assert.equal(calls[0].url, `${BASE}/api/tenants/talleres%20ana/users`)
  assert.equal(calls[0].init.method, 'GET')

  const portal = await client.billing.portal({ return_url: 'https://central.pimia.es/facturacion' })
  assert.equal(portal.data.portal_url, 'https://billing.stripe.test/p')
  assert.equal(calls[1].url, `${BASE}/api/billing/portal`)
  assert.equal(calls[1].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[1].init.body), { return_url: 'https://central.pimia.es/facturacion' })

  // Sin cuerpo también vale: el núcleo vuelve al panel Vue.
  await client.billing.portal()
  assert.deepEqual(JSON.parse(calls[2].init.body), {})
})

test('1.15.0: la cuenta de correo del integrador, por la ruta del contrato', async () => {
  const cuenta = { configured: true, mail_driver: 'smtp', from_name: 'Zoomo', from_mail: 'hola@erpstudio.es', reply_to: null, mail_password_set: true }
  const { client, calls } = clientWith((url, init) => {
    if (url.endsWith('/prueba')) return json({ success: false, error: 'mail_send_failed', reason: 'auth_failed' })
    return json(init.method === 'GET' ? { data: cuenta } : { message: 'ok', data: cuenta })
  })

  const leida = await client.correo.get()
  assert.equal(leida.data.mail_password_set, true)
  await client.correo.update({ mail_driver: 'smtp', from_name: 'Zoomo', from_mail: 'hola@erpstudio.es', mail_host: 'smtp.erpstudio.es', mail_port: '587' })
  const prueba = await client.correo.test({ to: 'yo@erpstudio.es' })
  await client.correo.delete()

  // La prueba contesta 200 aunque falle: no lanza, se mira `success`.
  assert.deepEqual(prueba, { success: false, error: 'mail_send_failed', reason: 'auth_failed' })
  assert.deepEqual(
    calls.map((c) => `${c.init.method} ${c.url.slice(BASE.length)}`),
    [
      'GET /api/desarrollador/correo',
      'PUT /api/desarrollador/correo',
      'POST /api/desarrollador/correo/prueba',
      'DELETE /api/desarrollador/correo',
    ],
  )
  assert.equal(JSON.parse(calls[1].init.body).mail_host, 'smtp.erpstudio.es')
  assert.deepEqual(JSON.parse(calls[2].init.body), { to: 'yo@erpstudio.es' })
  assert.equal(calls[3].init.body, undefined)
})

test('1.15.0: un servidor de correo no público es ValidationError con code mail_host_not_allowed', async () => {
  const { client } = clientWith(() =>
    json({ message: 'El servidor de correo tiene que ser público.', code: 'mail_host_not_allowed', errors: { mail_host: ['no público'] } }, 422),
  )
  await assert.rejects(
    () => client.correo.update({ mail_driver: 'smtp', from_name: 'x', from_mail: 'x@example.com', mail_host: '10.0.0.1' }),
    (error) => error instanceof ValidationError && error.code === 'mail_host_not_allowed' && error.errors.mail_host[0] === 'no público',
  )
})

test('1.15.0: el Stripe propio del integrador, por la ruta del contrato', async () => {
  const estado = {
    linked: true,
    publishable_key: 'pk_test_x',
    secret_key_set: true,
    webhook_secret_set: false,
    mode: 'test',
    account_id: 'acct_1',
    account_name: 'Zoomo',
    verified_at: '2026-09-14T10:00:00Z',
    webhook_url: 'https://pimia.es/api/stripe/integrador/abc',
    webhook_events: ['payment_intent.succeeded', 'payment_intent.payment_failed'],
  }
  const { client, calls } = clientWith(() => json({ data: estado }))

  const leido = await client.stripe.get()
  assert.equal(leido.data.webhook_url, 'https://pimia.es/api/stripe/integrador/abc')
  await client.stripe.update({ publishable_key: 'pk_test_x', secret_key: 'sk_test_y', webhook_secret: null, mode: 'test' })
  await client.stripe.delete()

  assert.deepEqual(
    calls.map((c) => `${c.init.method} ${c.url.slice(BASE.length)}`),
    ['GET /api/desarrollador/stripe', 'PUT /api/desarrollador/stripe', 'DELETE /api/desarrollador/stripe'],
  )
  // `null` viaja: es lo que borra el whsec_ y apaga la recepción.
  assert.deepEqual(JSON.parse(calls[1].init.body), { publishable_key: 'pk_test_x', secret_key: 'sk_test_y', webhook_secret: null, mode: 'test' })
  assert.equal('webhook' in client.stripe, false, 'el receptor es de Stripe, no un método del cliente')
})

test('1.15.0: los cortes de Stripe llegan tipados por status y con su code', async () => {
  const permisos = clientWith(() => json({ code: 'stripe_key_permissions', missing_permissions: ['balance:read'] }, 422))
  await assert.rejects(
    () => permisos.client.stripe.update({ publishable_key: 'pk_live_x', secret_key: 'rk_live_y', mode: 'live' }),
    (error) =>
      error instanceof ValidationError &&
      error.code === 'stripe_key_permissions' &&
      error.body.missing_permissions[0] === 'balance:read',
  )

  const invalida = clientWith(() => json({ code: 'stripe_key_invalid' }, 422))
  await assert.rejects(() => invalida.client.stripe.update({ publishable_key: 'pk_test_x', mode: 'test' }), (e) => e.code === 'stripe_key_invalid')

  const intentos = clientWith(() => json({ code: 'stripe_too_many_attempts', retry_after: 1800 }, 429, { 'retry-after': '1800' }))
  await assert.rejects(
    () => intentos.client.stripe.update({ publishable_key: 'pk_test_x', mode: 'test' }),
    (error) => error instanceof RateLimitError && error.retryAfter === 1800 && error.code === 'stripe_too_many_attempts',
  )
  assert.equal(intentos.calls.length, 1, 'el cliente central no reintenta un 429')

  const caida = clientWith(() => json({ code: 'stripe_unavailable' }, 503))
  await assert.rejects(
    () => caida.client.stripe.update({ publishable_key: 'pk_test_x', mode: 'test' }),
    (error) => error instanceof PimiaApiError && error.status === 503 && error.code === 'stripe_unavailable',
  )
})

test('code cae a `error` cuando no hay `code`, y es undefined sin cuerpo JSON', async () => {
  const correo = clientWith(() =>
    json({ error: 'integrator_mail_failed', code: 'integrator_mail_failed', message: 'No se pudo enviar.' }, 502),
  )
  await assert.rejects(
    () => correo.client.invitations.create({ email: 'ana@example.com', company_name: 'Ana', billing: 'sponsor' }),
    (error) => error.status === 502 && error.code === 'integrator_mail_failed',
  )

  const habilidad = clientWith(() => json({ error: 'token_sin_habilidad', required_ability: 'desarrollador' }, 403))
  await assert.rejects(() => habilidad.client.stripe.get(), (e) => e instanceof MissingAbilityError && e.code === 'token_sin_habilidad')

  const texto = clientWith(() => new Response('Bad Gateway', { status: 502 }))
  await assert.rejects(() => texto.client.correo.get(), (e) => e instanceof PimiaApiError && e.code === undefined)
})

test('1.16.0: los ajustes de «Facturo con Pimia», por la ruta del contrato', async () => {
  const { client, calls } = clientWith(() =>
    json({ data: { factura_con_pimia: true, tenant_emisor_id: 'mi-empresa', tipo_iva: '21.00', emisoras: [] } }),
  )

  await client.facturacionAClientes.get()
  await client.facturacionAClientes.update({ factura_con_pimia: true, tenant_emisor_id: 'mi-empresa', tipo_iva: 21 })

  assert.equal(calls[0].url, `${BASE}/api/desarrollador/facturacion-a-clientes`)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[1].url, `${BASE}/api/desarrollador/facturacion-a-clientes`)
  assert.equal(calls[1].init.method, 'PUT')
  assert.deepEqual(JSON.parse(calls[1].init.body), { factura_con_pimia: true, tenant_emisor_id: 'mi-empresa', tipo_iva: 21 })
})

test('1.16.0: el listado de facturas manda estado y cursor, y omite los que no vienen', async () => {
  const { client, calls } = clientWith(() => json({ data: [], next_cursor: null }))

  await client.facturasAClientes.list()
  await client.facturasAClientes.list({ estado: 'pendiente_sin_nif', cursor: 50 })

  assert.equal(calls[0].url, `${BASE}/api/desarrollador/facturas-a-clientes`)
  assert.equal(calls[1].url, `${BASE}/api/desarrollador/facturas-a-clientes?estado=pendiente_sin_nif&cursor=50`)
})

test('1.16.0: iterate sigue next_cursor hasta null y conserva el filtro', async () => {
  const paginas = {
    '': { data: [{ id: 1 }, { id: 2 }], next_cursor: 2 },
    2: { data: [{ id: 3 }], next_cursor: 3 },
    3: { data: [], next_cursor: null },
  }
  const { client, calls } = clientWith((url) => {
    const cursor = new URL(url).searchParams.get('cursor') ?? ''
    return json(paginas[cursor])
  })

  const ids = []
  for await (const fila of client.facturasAClientes.iterate({ estado: 'error' })) ids.push(fila.id)

  assert.deepEqual(ids, [1, 2, 3])
  assert.equal(calls.length, 3)
  assert.ok(calls.every((c) => new URL(c.url).searchParams.get('estado') === 'error'))
})

test('1.16.0: iterate es perezoso y no entra en bucle con un cursor que no avanza', async () => {
  const perezoso = clientWith(() => json({ data: [{ id: 1 }, { id: 2 }], next_cursor: 2 }))
  for await (const fila of perezoso.client.facturasAClientes.iterate()) {
    if (fila.id === 1) break
  }
  assert.equal(perezoso.calls.length, 1, 'cortar el for await no pide la página siguiente')

  const atascado = clientWith(() => json({ data: [{ id: 9 }], next_cursor: 9 }))
  const filas = []
  for await (const fila of atascado.client.facturasAClientes.iterate()) filas.push(fila)
  assert.equal(atascado.calls.length, 2)
  assert.equal(filas.length, 2)
})

test('1.16.0: reintentar acepta el 202 del núcleo; el 409 y el 404 llegan tipados', async () => {
  const bien = clientWith(() => json({ data: { id: 7, estado: 'pendiente' } }, 202))
  const r = await bien.client.facturasAClientes.retry(7)
  assert.deepEqual(r, { data: { id: 7, estado: 'pendiente' } })
  assert.equal(bien.calls[0].url, `${BASE}/api/desarrollador/facturas-a-clientes/7/reintentar`)
  assert.equal(bien.calls[0].init.method, 'POST')

  const conflicto = clientWith(() => json({ message: 'Solo se reintentan cobros con error o pendientes de NIF.' }, 409))
  await assert.rejects(() => conflicto.client.facturasAClientes.retry(7), (e) => e instanceof PimiaApiError && e.status === 409)

  const ajena = clientWith(() => json({ message: 'Not Found' }, 404))
  await assert.rejects(() => ajena.client.facturasAClientes.retry(8), (e) => e instanceof NotFoundError)
})

test('1.16.0: stripe_account_in_use y contratacion_gestionada_por_stripe llegan en code', async () => {
  const enUso = clientWith(() => json({ code: 'stripe_account_in_use' }, 409))
  await assert.rejects(() => enUso.client.stripe.delete(), (e) => e.status === 409 && e.code === 'stripe_account_in_use')

  const gestionada = clientWith(() => json({ code: 'contratacion_gestionada_por_stripe' }, 409))
  await assert.rejects(
    () => gestionada.client.request('/desarrollador/tenants/acme/contratacion', { method: 'PUT', body: {} }),
    (e) => e.status === 409 && e.code === 'contratacion_gestionada_por_stripe',
  )
})
