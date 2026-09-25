/**
 * La Mensajería sobre wab-ai (factSaas#963): rutas, la Idempotency-Key del
 * envío atada a su `operation_id`, el multipart del adjunto, los bytes del
 * medio y el catálogo de códigos. Con un `fetch` de mentira: sin red.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

import { MemoryTokenStore, PimiaApiError, PimiaClient, mensajeriaError } from '../dist/index.js'

const BASE = 'https://acme.pimia.es'
const CONV = '0f96caec-0000-4000-8000-000000000001'
const OP = '5b1d7c9e-3a2f-4e8b-9c1d-2f3e4a5b6c7d'
const MSG = '7c2e9f10-1111-4222-8333-444455556666'

function clientWith(handler) {
  const calls = []
  const client = new PimiaClient({
    baseUrl: BASE,
    clientId: 'mcp_test',
    redirectUri: 'https://pimia.example/cb',
    tokens: new MemoryTokenStore({ accessToken: 'at-1' }),
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return handler(String(url), init, calls.length)
    },
  })

  return { client, calls }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const operacion = (state, extra = {}) => ({
  id: OP,
  conversation_id: CONV,
  state,
  kind: 'text',
  text: state === 'sent' ? null : 'Hola',
  file_name: null,
  created_at: '2026-09-26T10:00:00+00:00',
  message: null,
  error_code: null,
  ...extra,
})

test('cada operación pega en su ruta y con su método', async () => {
  const { client, calls } = clientWith(() => json({ data: {} }))
  const m = client.mensajeria

  await m.link.get()
  await m.link.createIntent({ return_to: 'mensajes' })
  await m.link.unlink()
  await m.accounts()
  await m.conversations.list({ filter: '24h', q: 'vera', cursor: 'c/2', limit: 20 })
  await m.conversations.get(CONV)
  await m.conversations.markRead(CONV)
  await m.conversations.setFlags(CONV, { archived: true, pinned: false })
  await m.messages.list(CONV, { before: 'cur', limit: 50 })
  await m.operations.get(OP)
  await m.operations.list(CONV, { state: 'uncertain' })
  await m.chats.create({ network: 'telegram', identifier: '@alguien' })

  const vistas = calls.map((c) => `${c.init.method} ${c.url.replace(BASE, '')}`)
  assert.deepEqual(vistas, [
    'GET /api/v1/mensajeria/link',
    'POST /api/v1/mensajeria/link/intents',
    'DELETE /api/v1/mensajeria/link',
    'GET /api/v1/mensajeria/accounts',
    'GET /api/v1/mensajeria/conversations?filter=24h&q=vera&cursor=c%2F2&limit=20',
    `GET /api/v1/mensajeria/conversations/${CONV}`,
    `POST /api/v1/mensajeria/conversations/${CONV}/read`,
    `PATCH /api/v1/mensajeria/conversations/${CONV}/flags`,
    `GET /api/v1/mensajeria/conversations/${CONV}/messages?before=cur&limit=50`,
    `GET /api/v1/mensajeria/operations/${OP}`,
    `GET /api/v1/mensajeria/conversations/${CONV}/operations?state=uncertain`,
    'POST /api/v1/mensajeria/chats',
  ])

  assert.deepEqual(JSON.parse(calls[1].init.body), { return_to: 'mensajes' })
  // Los flags viajan como booleanos JSON de verdad: el servidor rechaza "true" o 1.
  assert.equal(calls[7].init.body, '{"archived":true,"pinned":false}')
  assert.deepEqual(JSON.parse(calls[11].init.body), { network: 'telegram', identifier: '@alguien' })
  // Solo el envío lleva clave: el resto de escrituras no manda Idempotency-Key.
  for (const i of [1, 6, 7, 11]) assert.equal(calls[i].init.headers['idempotency-key'], undefined)
})

test('el envío usa SIEMPRE su operation_id como Idempotency-Key, también al reintentar', async () => {
  const respuestas = [operacion('uncertain'), operacion('sent', { message: { id: OP } })]
  const { client, calls } = clientWith((_, __, n) => json({ data: { operation: respuestas[n - 1] } }, n === 1 ? 202 : 201))
  const cuerpo = { operation_id: OP, kind: 'text', text: 'Hola' }

  const primero = await client.mensajeria.messages.send(CONV, cuerpo)
  // Una clave puesta a mano no sustituye al operation_id (la opción no existe en
  // el tipo; en JS suelto se ignora igual).
  const segundo = await client.mensajeria.messages.send(CONV, cuerpo, { idempotencyKey: 'otra', headers: { 'idempotency-key': 'otra' } })

  assert.equal(primero.data.operation.state, 'uncertain')
  assert.equal(segundo.data.operation.state, 'sent')
  for (const call of calls) {
    assert.equal(call.url, `${BASE}/api/v1/mensajeria/conversations/${CONV}/messages`)
    assert.equal(call.init.method, 'POST')
    assert.equal(call.init.headers['idempotency-key'], OP)
    assert.deepEqual(JSON.parse(call.init.body), cuerpo)
  }
})

test('sin operation_id el envío ni sale', () => {
  const { client, calls } = clientWith(() => json({}))
  assert.throws(() => client.mensajeria.messages.send(CONV, { kind: 'text', text: 'Hola' }), TypeError)
  assert.equal(calls.length, 0)
})

test('el adjunto sube en multipart con file y operation_id, sin content-type a mano', async () => {
  const { client, calls } = clientWith(() =>
    json({ data: { attachment_id: '01J0000000000000000000000A', name: 'obra.pdf', mime_type: 'application/pdf', size: 4, kind: 'document' } }, 201),
  )

  const r = await client.mensajeria.attachments.upload(CONV, OP, [new Blob(['%PDF'], { type: 'application/pdf' }), 'obra.pdf'])

  const [call] = calls
  assert.equal(call.url, `${BASE}/api/v1/mensajeria/conversations/${CONV}/attachments`)
  assert.ok(call.init.body instanceof FormData)
  assert.equal(call.init.body.get('operation_id'), OP)
  assert.equal(call.init.body.get('file').name, 'obra.pdf')
  assert.equal(call.init.headers['content-type'], undefined)
  assert.equal(r.data.kind, 'document')
})

test('el medio vuelve como Blob con sus bytes exactos, y part viaja en la query', async () => {
  const bytes = new Uint8Array([0x00, 0xff, 0x7b, 0x22])
  const { client, calls } = clientWith(
    () => new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
  )

  const blob = await client.mensajeria.media(MSG, { part: 1 })

  assert.equal(calls[0].url, `${BASE}/api/v1/mensajeria/messages/${MSG}/media?part=1`)
  assert.equal(calls[0].init.headers.accept, '*/*')
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes)
})

test('los ids viajan escapados: un id no puede cambiar la ruta', async () => {
  const { client, calls } = clientWith(() => json({ data: {} }))
  await client.mensajeria.conversations.get('../link?x=1')
  assert.equal(calls[0].url, `${BASE}/api/v1/mensajeria/conversations/..%2Flink%3Fx%3D1`)
})

test('mensajeriaError lee el code estable y deja fuera lo que no es del catálogo', async () => {
  const casos = [
    [409, 'messaging_link_revoked', 'messaging_link_revoked'],
    [403, 'module_not_installed', 'module_not_installed'],
    [404, 'operation_unknown', 'operation_unknown'],
    [422, 'idempotency_key_reused', 'idempotency_key_reused'],
    [402, 'wab_quota_exceeded', 'wab_quota_exceeded'],
    [422, 'draft_changed', null],
  ]
  for (const [status, code, esperado] of casos) {
    const { client } = clientWith(() => json({ message: 'x', code, error: code }, status))
    await assert.rejects(client.mensajeria.link.get(), (e) => {
      assert.ok(e instanceof PimiaApiError)
      assert.equal(mensajeriaError(e), esperado, `${status} ${code}`)
      return true
    })
  }
  assert.equal(mensajeriaError(new Error('x')), null)
})

test('los tipos de la Mensajería compilan como promete el contrato', () => {
  const result = spawnSync(
    process.execPath,
    ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'test/types/mensajeria.ts'],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
