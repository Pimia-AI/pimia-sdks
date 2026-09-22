import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { PimiaClient } from '../dist/index.js'

const signature = {
  status: 'SENT', version: 1, sent_at: '2026-09-22T10:00:00Z',
  signed_at: null, source_document_sha256: 'a'.repeat(64), signed_document_sha256: null,
}
const envelope = { data: { id: 7, signature } }
const body = { name: 'Ana', email: 'ana@example.test', send_email: false, subject: 'Firma', body: 'Tu contrato' }

for (const [action, method, suffix, status, response] of [
  ['send', 'POST', '', 200, { ...envelope, signingUrl: 'https://firma.example.test/capacidad-ficticia' }],
  ['status', 'GET', '', 200, envelope],
  ['cancel', 'DELETE', '', 200, { data: { id: 7, signature: { ...signature, status: 'NONE' } } }],
  ['remind', 'POST', '/remind', 202, { success: true }],
]) {
  test(`firma: ${action} conserva método, cuerpo, opciones y respuesta ${status}`, async () => {
    const calls = []
    const client = PimiaClient.withBorrowedToken({
      baseUrl: 'https://acme.pimia.es', accessToken: 'token-ficticio',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init })
        return new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } })
      },
    })
    const signal = new AbortController().signal
    const options = { headers: { company: '3' }, signal, ...(method === 'POST' ? { idempotencyKey: `firma-${action}` } : {}) }
    const result = action === 'send'
      ? await client.contracts.signature.send(7, body, options)
      : await client.contracts.signature[action]('7', options)

    assert.deepEqual(result, response)
    assert.equal(calls.length, 1)
    const { url, init } = calls[0]
    assert.equal(url, `https://acme.pimia.es/api/v1/contracts/7/signature${suffix}`)
    assert.equal(init.method, method)
    assert.equal(init.headers.company, '3')
    assert.equal(init.signal, signal)
    if (method === 'POST') {
      assert.equal(init.headers['idempotency-key'], `firma-${action}`)
      assert.deepEqual(JSON.parse(init.body), action === 'send' ? body : {})
    } else {
      assert.equal(init.body, undefined)
    }
    // El cliente no fabrica una capacidad al consultar, cancelar o recordar.
    if (action !== 'send') assert.equal('signingUrl' in result, false)
  })
}

test('firma: los tipos públicos conservan el 202 y limitan signingUrl al envío', () => {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'test/types/contracts-signature.ts'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
