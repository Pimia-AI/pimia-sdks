/**
 * Tests del cliente con un `fetch` de mentira: sin red, sin servidor.
 * El foco está en lo que puede tumbar una integración de verdad — la rotación
 * del refresh y su concurrencia — más el contrato de errores del api-guard.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DuplicateExternalRefError,
  MemoryTokenStore,
  MissingScopeError,
  NotAuthenticatedError,
  PimiaClient,
  RateLimitError,
  UnauthorizedError,
  toFormData,
  ValidationError,
} from '../dist/index.js'

const BASE = 'https://acme.pimia.es'

function clientWith(handler, tokens, options = {}) {
  const calls = []
  const store = new MemoryTokenStore(tokens)

  const client = new PimiaClient({
    baseUrl: BASE,
    clientId: 'mcp_test',
    clientSecret: 'pcs_test',
    redirectUri: 'https://partner.example/cb',
    tokens: store,
    maxRetryDelayMs: 5,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return handler(String(url), init, calls.length)
    },
    ...options,
  })

  return { client, calls, store }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

test('manda el bearer y compone la URL con /api/v1 y query', async () => {
  const { client, calls } = clientWith(
    () => json({ data: [] }),
    { accessToken: 'at-1' },
  )

  await client.get('/invoices', { page: 2, status: ['SENT', 'PAID'], vacio: undefined })

  const [call] = calls
  assert.equal(
    call.url,
    `${BASE}/api/v1/invoices?page=2&status%5B%5D=SENT&status%5B%5D=PAID`,
  )
  assert.equal(call.init.headers.authorization, 'Bearer at-1')
})

test('acepta el path con y sin prefijo /api/v1', async () => {
  const { client, calls } = clientWith(() => json({}), { accessToken: 'at-1' })

  await client.get('/api/v1/customers')
  await client.get('customers')

  assert.equal(calls[0].url, `${BASE}/api/v1/customers`)
  assert.equal(calls[1].url, `${BASE}/api/v1/customers`)
})

test('sin tokens en el store no llama a la API', async () => {
  const { client, calls } = clientWith(() => json({}), null)

  await assert.rejects(() => client.get('/invoices'), NotAuthenticatedError)
  assert.equal(calls.length, 0)
})

test('refresca antes de llamar si el access token está caducado y persiste la rotación', async () => {
  const { client, calls, store } = clientWith(
    (url) => {
      if (url.endsWith('/oauth/token')) {
        return json({
          access_token: 'at-2',
          refresh_token: 'prt-2',
          expires_in: 86400,
          scope: 'invoices:read',
        })
      }
      return json({ data: [] })
    },
    { accessToken: 'at-1', refreshToken: 'prt-1', expiresAt: Date.now() - 1000 },
  )

  await client.get('/invoices')

  assert.equal(calls[0].url, `${BASE}/oauth/token`)
  assert.match(calls[0].init.body, /grant_type=refresh_token&refresh_token=prt-1/)
  assert.equal(calls[1].init.headers.authorization, 'Bearer at-2')

  // Lo que evita el suicidio del grant: el refresh NUEVO queda persistido.
  const saved = store.load()
  assert.equal(saved.refreshToken, 'prt-2')
  assert.equal(saved.accessToken, 'at-2')
  assert.ok(saved.expiresAt > Date.now())
})

test('un 401 dispara UN refresco y reintenta la petición', async () => {
  let apiCalls = 0
  const { client, calls } = clientWith(
    (url) => {
      if (url.endsWith('/oauth/token')) {
        return json({ access_token: 'at-2', refresh_token: 'prt-2', expires_in: 86400 })
      }
      apiCalls++
      return apiCalls === 1
        ? json({ message: 'Unauthenticated.' }, 401)
        : json({ data: { id: 7 } })
    },
    { accessToken: 'at-1', refreshToken: 'prt-1' },
  )

  const result = await client.get('/invoices/7')

  assert.deepEqual(result, { data: { id: 7 } })
  assert.equal(apiCalls, 2)
  assert.equal(calls.filter((c) => c.url.endsWith('/oauth/token')).length, 1)
})

test('si tras refrescar sigue en 401 (usuario revocó la app) el error sube', async () => {
  const { client, calls } = clientWith(
    (url) =>
      url.endsWith('/oauth/token')
        ? json({ access_token: 'at-2', refresh_token: 'prt-2', expires_in: 86400 })
        : json({ message: 'Unauthenticated.' }, 401),
    { accessToken: 'at-1', refreshToken: 'prt-1' },
  )

  await assert.rejects(() => client.get('/invoices'), UnauthorizedError)
  // Un solo refresco: no entra en bucle.
  assert.equal(calls.filter((c) => c.url.endsWith('/oauth/token')).length, 1)
})

test('N peticiones caducadas en paralelo canjean el refresh UNA vez (evita el reuse)', async () => {
  let tokenCalls = 0
  const { client, store } = clientWith(
    (url) => {
      if (url.endsWith('/oauth/token')) {
        tokenCalls++
        return json({ access_token: `at-${tokenCalls + 1}`, refresh_token: 'prt-2', expires_in: 86400 })
      }
      return json({ ok: true })
    },
    { accessToken: 'at-1', refreshToken: 'prt-1', expiresAt: Date.now() - 1000 },
  )

  await Promise.all([
    client.get('/invoices'),
    client.get('/customers'),
    client.get('/estimates'),
  ])

  // Con un canje por petición, el servidor vería 2 reusos y revocaría el grant.
  assert.equal(tokenCalls, 1)
  assert.equal(store.load().refreshToken, 'prt-2')
})

test('si el usuario revocó la app, el 401 llega como UnauthorizedError (no como OAuthError)', async () => {
  // Escenario REAL del e2e contra dev: se revoca el grant desde el panel, el
  // access token deja de valer y el refresh tampoco. Quien llama a la API tiene
  // que recibir UnauthorizedError («re-autoriza al usuario»), no el error del
  // token endpoint colándose por debajo del contrato.
  const { client } = clientWith(
    (url) =>
      url.endsWith('/oauth/token')
        ? json({ error: 'invalid_grant' }, 400)
        : json({ message: 'Unauthenticated.' }, 401),
    { accessToken: 'at-1', refreshToken: 'prt-revocado' },
  )

  await assert.rejects(
    () => client.get('/invoices'),
    (error) => {
      assert.ok(error instanceof UnauthorizedError, `esperaba UnauthorizedError, no ${error.constructor.name}`)
      assert.match(error.message, /vuelve a pedir autorización/)
      // La causa original sigue disponible para diagnosticar.
      assert.equal(error.cause?.error, 'invalid_grant')
      return true
    },
  )
})

test('un refresco proactivo fallido también llega como UnauthorizedError', async () => {
  const { client } = clientWith(
    (url) => (url.endsWith('/oauth/token') ? json({ error: 'invalid_grant' }, 400) : json({})),
    { accessToken: 'at-1', refreshToken: 'prt-revocado', expiresAt: Date.now() - 1000 },
  )

  await assert.rejects(() => client.get('/invoices'), UnauthorizedError)
})

test('sin refresh token y access caducado no inventa nada', async () => {
  const { client } = clientWith(() => json({}), {
    accessToken: 'at-1',
    expiresAt: Date.now() - 1000,
  })

  await assert.rejects(() => client.get('/invoices'), UnauthorizedError)
})

test('un 403 del api-guard llega como MissingScopeError con el scope exacto', async () => {
  const { client } = clientWith(
    () => json({ message: 'Token lacks the invoices:write scope' }, 403),
    { accessToken: 'at-1' },
  )

  await assert.rejects(
    () => client.post('/invoices', { total: 100 }),
    (error) => {
      assert.ok(error instanceof MissingScopeError)
      assert.equal(error.scope, 'invoices:write')
      assert.equal(error.status, 403)
      return true
    },
  )
})

test('un 422 expone los errores por campo', async () => {
  const { client } = clientWith(
    () => json({ message: 'The given data was invalid.', errors: { customer_id: ['requerido'] } }, 422),
    { accessToken: 'at-1' },
  )

  await assert.rejects(
    () => client.post('/invoices', {}),
    (error) => {
      assert.ok(error instanceof ValidationError)
      assert.deepEqual(error.errors, { customer_id: ['requerido'] })
      return true
    },
  )
})

/** Cuerpo exacto de `App\Exceptions\DuplicateExternalRef::render()` del core. */
function cuerpoDeRefDuplicada(existingId = 41) {
  const mensaje = `La referencia externa «deal_42» ya está asociada a customer ${existingId}.`

  return {
    error: 'external_ref_already_used',
    message: mensaje,
    external_ref: 'deal_42',
    entity_type: 'customer',
    existing_id: existingId,
    errors: { external_ref: [mensaje] },
  }
}

test('la referencia duplicada llega como DuplicateExternalRefError con el id existente', async () => {
  const { client } = clientWith(() => json(cuerpoDeRefDuplicada(), 422), { accessToken: 'at-1' })

  await assert.rejects(
    () => client.post('/customers', { name: 'Acme', external_ref: 'deal_42' }),
    (error) => {
      assert.ok(error instanceof DuplicateExternalRefError)
      // Lo que cierra el find-or-create sin mapeo local.
      assert.equal(error.existingId, 41)
      assert.equal(error.externalRef, 'deal_42')
      assert.equal(error.entityType, 'customer')
      // Sigue siendo un 422 de validación: quien ya trataba `errors` no se entera.
      assert.ok(error instanceof ValidationError)
      assert.deepEqual(error.errors, { external_ref: [cuerpoDeRefDuplicada().message] })
      return true
    },
  )
})

test('un 422 corriente NO se promueve a DuplicateExternalRefError', async () => {
  const { client } = clientWith(
    () => json({ message: 'The given data was invalid.', errors: { external_ref: ['muy largo'] } }, 422),
    { accessToken: 'at-1' },
  )

  await assert.rejects(
    () => client.post('/customers', {}),
    (error) => {
      assert.ok(error instanceof ValidationError)
      assert.ok(!(error instanceof DuplicateExternalRefError))
      return true
    },
  )
})

test('sin existing_id usable se queda en ValidationError: no hay find-or-create que hacer', async () => {
  const { client } = clientWith(
    () => json({ ...cuerpoDeRefDuplicada(), existing_id: null }, 422),
    { accessToken: 'at-1' },
  )

  await assert.rejects(
    () => client.post('/customers', {}),
    (error) => {
      assert.ok(error instanceof ValidationError)
      assert.ok(!(error instanceof DuplicateExternalRefError))
      return true
    },
  )
})

test('reintenta un 429 respetando Retry-After y acaba devolviendo el dato', async () => {
  let attempts = 0
  const { client } = clientWith(
    () => {
      attempts++
      return attempts === 1
        ? json({ message: 'Too Many Attempts.' }, 429, { 'retry-after': '0' })
        : json({ data: [] })
    },
    { accessToken: 'at-1' },
  )

  assert.deepEqual(await client.get('/invoices'), { data: [] })
  assert.equal(attempts, 2)
})

test('agotados los reintentos, RateLimitError con retryAfter', async () => {
  const { client } = clientWith(
    () => json({ message: 'Too Many Attempts.' }, 429, { 'retry-after': '7' }),
    { accessToken: 'at-1' },
    { maxRateLimitRetries: 1 },
  )

  await assert.rejects(
    () => client.get('/invoices'),
    (error) => {
      assert.ok(error instanceof RateLimitError)
      assert.equal(error.retryAfter, 7)
      return true
    },
  )
})

test('expone las cabeceras de rate limit de la última respuesta', async () => {
  const { client } = clientWith(
    () => json({ data: [] }, 200, { 'x-ratelimit-limit': '300', 'x-ratelimit-remaining': '297' }),
    { accessToken: 'at-1' },
  )

  await client.get('/invoices')

  assert.deepEqual(client.rateLimit, { limit: 300, remaining: 297 })
})

test('los helpers de dominio pegan en las rutas correctas', async () => {
  const { client, calls } = clientWith(() => json({}), { accessToken: 'at-1' })

  await client.invoices.list({ page: 1 })
  await client.invoices.get(42)
  await client.customers.create({ name: 'ACME' })

  assert.equal(calls[0].url, `${BASE}/api/v1/invoices?page=1`)
  assert.equal(calls[1].url, `${BASE}/api/v1/invoices/42`)
  assert.equal(calls[2].url, `${BASE}/api/v1/customers`)
  assert.equal(calls[2].init.method, 'POST')
  assert.equal(calls[2].init.headers['content-type'], 'application/json')
})

// ── Idempotencia ───────────────────────────────────────────────────────────
//
// El contrato dice que un reintento devuelve la MISMA respuesta que la
// primera llamada. Por eso el cuerpo solo no basta para saber si Pimia
// escribió o se limitó a repetirse, y de ahí `requestWithMeta`.

test('la clave de idempotencia viaja como cabecera', async () => {
  const { client, calls } = clientWith(() => json({ data: { id: 60 } }), {
    accessToken: 'at-1',
  })

  await client.estimates.create({ total: 45050 }, { idempotencyKey: 'deal-abc' })

  assert.equal(calls[0].init.headers['idempotency-key'], 'deal-abc')
})

test('sin clave no se manda la cabecera', async () => {
  const { client, calls } = clientWith(() => json({ data: {} }), { accessToken: 'at-1' })

  await client.estimates.create({ total: 1 })

  assert.equal(calls[0].init.headers['idempotency-key'], undefined)
})

test('requestWithMeta distingue la escritura real del eco', async () => {
  const respuesta = { data: { id: 60, estimate_number: 'PRE-000029' } }
  const { client } = clientWith(
    (_url, _init, n) =>
      n === 1
        ? json(respuesta, 201)
        : json(respuesta, 201, { 'idempotency-replayed': 'true' }),
    { accessToken: 'at-1' },
  )

  const primera = await client.requestWithMeta('/estimates', {
    method: 'POST',
    body: { total: 45050 },
    idempotencyKey: 'deal-abc',
  })
  const reintento = await client.requestWithMeta('/estimates', {
    method: 'POST',
    body: { total: 45050 },
    idempotencyKey: 'deal-abc',
  })

  // El cuerpo es idéntico: ESE es el contrato, y por eso no sirve para
  // distinguirlas.
  assert.deepEqual(primera.data, reintento.data)

  assert.equal(primera.meta.idempotentReplay, false)
  assert.equal(reintento.meta.idempotentReplay, true)
  assert.equal(reintento.meta.status, 201)
})

test('requestWithMeta trae también estado, request-id y rate limit', async () => {
  const { client } = clientWith(
    () =>
      json({ data: [] }, 200, {
        'x-request-id': 'req-42',
        'x-ratelimit-limit': '300',
        'x-ratelimit-remaining': '299',
      }),
    { accessToken: 'at-1' },
  )

  const { meta } = await client.requestWithMeta('/customers')

  assert.equal(meta.status, 200)
  assert.equal(meta.requestId, 'req-42')
  assert.deepEqual(meta.rateLimit, { limit: 300, remaining: 299 })
  assert.equal(meta.idempotentReplay, false)
})

test('request() sigue devolviendo solo el cuerpo', async () => {
  const { client } = clientWith(() => json({ data: { id: 7 } }), { accessToken: 'at-1' })

  assert.deepEqual(await client.request('/customers/7'), { data: { id: 7 } })
})

// ── Timeouts en las lecturas ────────────────────────────────────────────────
// Hasta la 0.4 los atajos de lectura no aceptaban opciones: `get(path, query)` y
// `delete(path)` a secas. Ponerle un timeout a un GET obligaba a bajar a
// `request()`, o a quedarse sin él — que es lo que pasa de verdad. Un cliente
// que sondea y se cuelga en una lectura deja de sondear sin dar un solo error.

test('get() propaga el AbortSignal', async () => {
  const { client, calls } = clientWith(() => json({ data: [] }), { accessToken: 'at-1' })
  const señal = AbortSignal.timeout(1000)

  await client.get('/invoices', { page: 1 }, { signal: señal })

  assert.equal(calls[0].init.signal, señal)
  // Y la query sigue en su sitio, que es el parámetro que ya existía.
  assert.match(calls[0].url, /\?page=1$/)
})

test('get() acepta opciones sin query', async () => {
  const { client, calls } = clientWith(() => json({}), { accessToken: 'at-1' })
  const señal = AbortSignal.timeout(1000)

  await client.get('/currencies', undefined, { signal: señal, headers: { 'x-probe': '1' } })

  assert.equal(calls[0].init.signal, señal)
  assert.equal(calls[0].init.headers['x-probe'], '1')
})

test('delete() propaga el AbortSignal', async () => {
  const { client, calls } = clientWith(() => json({}), { accessToken: 'at-1' })
  const señal = AbortSignal.timeout(1000)

  await client.delete('/customers/7', { signal: señal })

  assert.equal(calls[0].init.method, 'DELETE')
  assert.equal(calls[0].init.signal, señal)
})

test('los atajos de recurso también aceptan señal', async () => {
  const { client, calls } = clientWith(() => json({ data: [] }), { accessToken: 'at-1' })
  const señal = AbortSignal.timeout(1000)

  await client.customers.list({ page: 1 }, { signal: señal })
  await client.customers.get(7, { signal: señal })
  await client.estimates.list(undefined, { signal: señal })
  await client.invoices.get(9, { signal: señal })

  assert.deepEqual(calls.map((c) => c.init.signal), [señal, señal, señal, señal])
  // El `undefined` de la query no debe colarse en la URL.
  assert.equal(calls[2].url, `${BASE}/api/v1/estimates`)
  assert.equal(calls[3].url, `${BASE}/api/v1/invoices/9`)
})

// ── external_ref en la conversión ───────────────────────────────────────────

test('convertToInvoice manda external_ref en el cuerpo', async () => {
  const { client, calls } = clientWith(() => json({ data: { id: 900 } }), { accessToken: 'at-1' })

  await client.estimates.convertToInvoice(55, {
    externalRef: 'deal:42',
    idempotencyKey: 'deal:42:invoice',
  })

  const [call] = calls
  assert.equal(call.url, `${BASE}/api/v1/estimates/55/convert-to-invoice`)
  assert.deepEqual(JSON.parse(call.init.body), { external_ref: 'deal:42' })
  // La referencia NO debe filtrarse a las opciones de la petición.
  assert.equal(call.init.headers['idempotency-key'], 'deal:42:invoice')
})

test('convertToInvoice sin externalRef manda cuerpo vacío, no un null', async () => {
  const { client, calls } = clientWith(() => json({ data: { id: 900 } }), { accessToken: 'at-1' })

  // La llamada de siempre: no debe romperse ni cambiar de cuerpo.
  await client.estimates.convertToInvoice(55, { idempotencyKey: 'estimate:55:invoice' })

  assert.deepEqual(JSON.parse(calls[0].init.body), {})
})

test('convertToInvoice con externalRef null desvincula a propósito', async () => {
  const { client, calls } = clientWith(() => json({ data: { id: 900 } }), { accessToken: 'at-1' })

  await client.estimates.convertToInvoice(55, { externalRef: null })

  // Distinto de no mandarlo: el null explícito es «quítale la referencia».
  assert.deepEqual(JSON.parse(calls[0].init.body), { external_ref: null })
})

// ── Multipart: el cuerpo que NO se serializa ────────────────────────────────

test('un FormData viaja tal cual: ni JSON.stringify ni content-type', async () => {
  // 🔴 Es la regresión que este bloque existe para cerrar. Hasta la 0.7.0 el
  // cliente pasaba TODO cuerpo por `JSON.stringify`, así que un FormData salía
  // como la cadena `"{}"` — con `content-type: application/json` encima. La
  // llamada compilaba y el servidor contestaba 422 por un campo que sí se había
  // mandado, que es el peor sitio donde dejar un fallo.
  const { client, calls } = clientWith(() => json({ data: {} }), { accessToken: 'at-1' })

  const form = new FormData()
  form.append('document', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'factura.pdf')

  await client.post('/received-invoices/7/upload/document', form)

  const [call] = calls
  assert.ok(call.init.body instanceof FormData, 'el cuerpo tiene que seguir siendo un FormData')
  assert.equal(call.init.body.get('document').name, 'factura.pdf')

  // Sin `content-type`: lo pone el runtime, CON el `boundary`. Escribirlo aquí
  // se lo quitaría y el servidor no podría separar las partes.
  const cabeceras = Object.keys(call.init.headers).map((k) => k.toLowerCase())
  assert.ok(!cabeceras.includes('content-type'), `no debería llevar content-type: ${cabeceras}`)

  // Y lo que no cambia: el bearer sigue yendo.
  assert.equal(call.init.headers.authorization, 'Bearer at-1')
})

test('un cuerpo normal sigue siendo JSON, que es el 99 % de la API', async () => {
  const { client, calls } = clientWith(() => json({ data: {} }), { accessToken: 'at-1' })

  await client.post('/invoices', { total: 12100 })

  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].init.body), { total: 12100 })
})

test('los otros cuerpos nativos tampoco se serializan', async () => {
  const { client, calls } = clientWith(() => json({}), { accessToken: 'at-1' })

  const params = new URLSearchParams({ a: '1' })
  await client.post('/x', params)
  await client.post('/y', new Blob(['abc']))
  await client.post('/z', new Uint8Array([1, 2, 3]))

  assert.ok(calls[0].init.body instanceof URLSearchParams)
  assert.ok(calls[1].init.body instanceof Blob)
  assert.ok(calls[2].init.body instanceof Uint8Array)
  for (const call of calls) {
    const cabeceras = Object.keys(call.init.headers).map((k) => k.toLowerCase())
    assert.ok(!cabeceras.includes('content-type'))
  }
})

test('un FormData se puede REINTENTAR: sobrevive al refresco del 401', async () => {
  // Es el motivo de que un ReadableStream no entre en la lista: un cuerpo de un
  // solo uso reventaría aquí, en el segundo intento, con un error que no se
  // parece en nada a su causa.
  const { client, calls } = clientWith(
    (url, init, n) => {
      if (url.endsWith('/oauth/token')) {
        return json({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 })
      }
      return n === 1 ? json({ message: 'expirado' }, 401) : json({ data: { ok: true } })
    },
    { accessToken: 'at-1', refreshToken: 'rt-1' },
  )

  const form = new FormData()
  form.append('file', new Blob(['x']), 'extracto.csv')

  const salida = await client.post('/banking/import', form)

  assert.deepEqual(salida, { data: { ok: true } })
  const subidas = calls.filter((c) => c.url.includes('/banking/import'))
  assert.equal(subidas.length, 2, 'debería haber reintentado tras refrescar')
  assert.ok(subidas[1].init.body instanceof FormData)
  assert.equal(subidas[1].init.body.get('file').name, 'extracto.csv')
  assert.equal(subidas[1].init.headers.authorization, 'Bearer at-2')
})

test('poner content-type a mano sobre un FormData se rechaza, y se explica', async () => {
  // Sin `boundary` el servidor no puede parsear el cuerpo y contesta 422 sobre
  // un campo que sí se mandó. Se corta aquí, donde está el error.
  const { client, calls } = clientWith(() => json({}), { accessToken: 'at-1' })

  const form = new FormData()
  form.append('file', new Blob(['x']), 'x.csv')

  await assert.rejects(
    () => client.post('/banking/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
    (error) => {
      assert.ok(error instanceof TypeError)
      assert.match(error.message, /boundary/)
      assert.match(error.message, /Content-Type/)
      return true
    },
  )

  assert.equal(calls.length, 0, 'no debería haber salido ninguna petición')
})

// ── `toFormData`: las conversiones que el servidor espera ───────────────────

test('los booleanos viajan como 1 y 0, no como "true"', async () => {
  // Lo dice el spec en `ExpenseRequest.is_attachment_receipt_removed`. Un
  // `String(false)` daría `"false"`, que PHP lee como verdadero.
  const form = toFormData({ is_attachment_receipt_removed: false, activo: true })

  assert.equal(form.get('is_attachment_receipt_removed'), '0')
  assert.equal(form.get('activo'), '1')
})

test('los objetos y arrays viajan como JSON en una cadena', async () => {
  // También del spec, en `ExpenseRequest.customFields`.
  const form = toFormData({ customFields: [{ id: 3, value: 'REF-42' }] })

  assert.equal(form.get('customFields'), '[{"id":3,"value":"REF-42"}]')
})

test('null y undefined se OMITEN, en vez de mandar la cadena "null"', async () => {
  const form = toFormData({ a: null, b: undefined, c: 0 })

  assert.equal(form.has('a'), false)
  assert.equal(form.has('b'), false)
  // El cero sí va: es un valor, no un hueco.
  assert.equal(form.get('c'), '0')
})

test('un fichero se añade tal cual, y un Blob puede llevar nombre', async () => {
  const pdf = new Blob(['%PDF'], { type: 'application/pdf' })
  const form = toFormData({
    attachment_receipt: [pdf, 'ticket.pdf'],
    otro: new File(['x'], 'ya-tiene-nombre.png'),
  })

  assert.equal(form.get('attachment_receipt').name, 'ticket.pdf')
  assert.equal(form.get('otro').name, 'ya-tiene-nombre.png')
})

test('toFormData produce algo que el cliente manda sin tocar', async () => {
  // Las dos mitades juntas, que es como se usa de verdad.
  const { client, calls } = clientWith(() => json({ data: {} }), { accessToken: 'at-1' })

  await client.post('/expenses', toFormData({
    expense_date: '2026-08-24',
    expense_category_id: 3,
    amount: 12100,
    attachment_receipt: [new Blob(['%PDF']), 'ticket.pdf'],
  }))

  const cuerpo = calls[0].init.body
  assert.ok(cuerpo instanceof FormData)
  assert.equal(cuerpo.get('amount'), '12100')
  assert.equal(cuerpo.get('attachment_receipt').name, 'ticket.pdf')
})
