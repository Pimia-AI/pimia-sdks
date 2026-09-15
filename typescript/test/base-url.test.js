import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MemoryTokenStore, PimiaClient, PimiaCentralClient } from '../dist/index.js'

const makers = [
  (baseUrl, fetch) => new PimiaCentralClient({ baseUrl, token: 'fixture', fetch }),
  (baseUrl, fetch) => new PimiaClient({ baseUrl, clientId: 'fixture', redirectUri: 'https://app.test/cb', tokens: new MemoryTokenStore({ accessToken: 'fixture' }), fetch }),
  (baseUrl, fetch) => PimiaClient.withBorrowedToken({ baseUrl, accessToken: 'fixture', fetch }),
]
for (const [i, make] of makers.entries()) {
  test(`baseUrl: cliente ${i} rechaza prefijos antes de llamar a la red`, () => {
    let calls = 0
    for (const suffix of ['/api', '/api/', '/api/v1', '/api/v1///', '/api?x=1', '/api/v1/#fragmento']) {
      assert.throws(() => make('https://acme.pimia.es' + suffix, async () => { calls++; throw new Error('red') }), { name: 'TypeError', message: /baseUrl.*origen.*sin \/api/ })
    }
    assert.equal(calls, 0)
  })
  test(`baseUrl: cliente ${i} conserva origen, puerto y barras finales`, async () => {
    for (const base of ['https://acme.pimia.es', 'http://localhost:4319', 'https://api']) {
      for (const tail of ['', '/', '///']) {
        const calls = []
        const client = make(base + tail, async (url) => { calls.push(String(url)); return new Response('{}', { headers: { 'content-type': 'application/json' } }) })
        if (i === 0) await client.request('/customers')
        else await client.get('/customers')
        assert.deepEqual(calls, [base + (i === 0 ? '/api' : '/api/v1') + '/customers'])
      }
    }
  })
}
