import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { PimiaClient, PimiaCentralClient, PimiaApiError, isOwnerConfirmationRequired } from '../dist/index.js'

const pending = { code: 'owner_confirmation_required', message: 'Confirma por correo.', data: { id: 45 } }
const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const central = (body, status) => new PimiaCentralClient({ baseUrl: 'https://example.test', token: 'test', fetch: async () => json(body, status) })

test('el traspaso devuelve el 202 completo y reconoce su cuerpo', async () => {
  const r = await central(pending, 202).tenants.transferOwnership('acme', { user_id: 4 })
  assert.deepEqual(r, pending)
  assert.equal(isOwnerConfirmationRequired(r), true)
  await assert.rejects(central({ code: 'owner_confirmation_mail_failed', message: 'No enviado' }, 503).tenants.transferOwnership('acme', { user_id: 4 }), e => e.status === 503 && e.code === 'owner_confirmation_mail_failed')
  for (const malformed of [null, {}, { ...pending, data: {} }, { ...pending, data: { id: '45' } }]) {
    assert.equal(isOwnerConfirmationRequired(malformed), false)
  }
})

test('las diez operaciones de instancia con confirmación preservan cuerpo y estado y no reintentan el 503', async () => {
  const spec = JSON.parse(readFileSync(new URL('../../spec/pimia-api-v1.json', import.meta.url)))
  const affected = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods)
    .filter(([, op]) => op.responses?.['202']?.content?.['application/json']?.schema?.properties?.code?.enum?.includes('owner_confirmation_required'))
    .map(([method]) => [path.replace('{user}', '3').replace('{role}', 'admin'), method]))
  assert.equal(affected.length, 10)
  for (const [path, method] of affected) {
    let calls = 0
    let status = 202
    const client = PimiaClient.withBorrowedToken({ baseUrl: 'https://example.test', accessToken: 'test', fetch: async () => {
      calls++
      return json(status === 202 ? pending : { code: 'owner_confirmation_mail_failed' }, status)
    } })
    const response = await client.requestWithMeta(path, { method: method.toUpperCase() })
    assert.equal(response.meta.status, 202)
    assert.deepEqual(response.data, pending)
    status = 503
    await assert.rejects(client.request(path, { method: method.toUpperCase() }), e => e instanceof PimiaApiError && e.code === 'owner_confirmation_mail_failed')
    assert.equal(calls, 2)
  }
})

test('los tipos públicos fuerzan distinguir el pendiente y recogen todos los 202', () => {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'test/types/confirmation.ts'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
