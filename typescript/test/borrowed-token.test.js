/**
 * El modo «token prestado»: un cliente que reenvía el `Authorization` de otro.
 *
 * Foco: que **no posea nada**. Sin ceremonia OAuth, sin store que persistir y
 * —lo que más importa— sin intentar refrescar un grant que no es suyo. Un
 * refresco ahí no sería un fallo educado: con la rotación de Pimia, reusar el
 * refresh de otro revoca su grant entero en cascada.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BorrowedTokenStore,
  NotAuthenticatedError,
  PimiaClient,
  PimiaError,
  RateLimitError,
  UnauthorizedError,
} from '../dist/index.js'

const BASE = 'https://acme.pimia.es'

function borrowed(handler, options = {}) {
  const calls = []

  const client = PimiaClient.withBorrowedToken({
    baseUrl: BASE,
    accessToken: 'el-token-de-ana',
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

test('reenvía el bearer prestado y no monta ceremonia OAuth', async () => {
  const { client, calls } = borrowed(() => json({ data: [] }))

  await client.get('/customers')

  assert.equal(calls[0].init.headers.authorization, 'Bearer el-token-de-ana')
  assert.equal(calls[0].url, `${BASE}/api/v1/customers`)

  // Y `oauth` es null, no un OAuth a medias: sin clientId, una URL de
  // autorización saldría con `client_id=` vacío y el fallo aparecería en el
  // navegador del usuario, lejos de aquí.
  assert.equal(client.oauth, null)
})

test('las cabeceras fijas viajan, y omitirlas no manda ninguna', async () => {
  const conEmpresa = borrowed(() => json({}), { headers: { company: '7' } })
  const sinEmpresa = borrowed(() => json({}))

  await conEmpresa.client.get('/bootstrap')
  await sinEmpresa.client.get('/bootstrap')

  assert.equal(conEmpresa.calls[0].init.headers.company, '7')
  assert.equal(sinEmpresa.calls[0].init.headers.company, undefined)
})

/**
 * ⛔ EL TEST DE ESTE FICHERO: un 401 con un token prestado NO dispara un
 * refresco.
 *
 * Con grant propio, el cliente refresca y reintenta —hay un test suyo en
 * `client.test.js`—. Aquí no hay refresh token que usar, así que el 401 tiene
 * que subir tal cual **y con una sola llamada**: quien tiene que conseguir otro
 * token es quien prestó éste.
 */
test('un 401 no intenta refrescar lo que no es suyo', async () => {
  const { client, calls } = borrowed(() => json({ message: 'Unauthenticated.' }, 401))

  await assert.rejects(() => client.get('/customers'), UnauthorizedError)

  assert.equal(calls.length, 1, 'ha habido una segunda llamada: alguien ha intentado refrescar')
  assert.equal(
    calls.filter((call) => call.url.includes('/oauth/token')).length,
    0,
  )
})

/**
 * Un token vacío se corta ANTES de llamar.
 *
 * Si no, el 401 llegaría desde Pimia y se confundiría con un token caducado —
 * cuando lo que pasa es que la cabecera `Authorization` de la petición que
 * atiendes venía vacía.
 */
test('un token vacío no llega a construir el cliente', () => {
  assert.throws(
    () =>
      PimiaClient.withBorrowedToken({
        baseUrl: BASE,
        accessToken: '   ',
        fetch: () => {
          throw new Error('no se debería haber llamado')
        },
      }),
    NotAuthenticatedError,
  )
})

/**
 * Sin reintentos, un 429 sube en vez de esperar.
 *
 * Es lo que recomienda el modo para un servicio que atiende peticiones web: los
 * reintentos del SDK ESPERAN, y esperar dentro de la petición de un usuario es
 * una petición colgada y un proceso ocupado.
 */
test('con los reintentos a cero el 429 sube sin esperar', async () => {
  const { client, calls } = borrowed(() => json({ message: 'slow down' }, 429), {
    maxRateLimitRetries: 0,
  })

  await assert.rejects(() => client.get('/customers'), RateLimitError)
  assert.equal(calls.length, 1)
})

/**
 * El store de un token prestado se niega a guardar.
 *
 * Hoy nadie le llama —el cliente sólo persiste tras un refresco, y aquí no hay
 * refrescos—, y el guardia existe para que el día que ese camino cambie el
 * error diga qué pasa aquí y no en el grant de otro.
 */
test('el store prestado se niega a guardar y no tiene nada que borrar', () => {
  const store = new BorrowedTokenStore('at-prestado')

  assert.equal(store.load().accessToken, 'at-prestado')
  assert.equal(
    store.load().refreshToken,
    undefined,
    'un token prestado no trae refresh: el refresh es del dueño',
  )

  store.clear()
  assert.equal(store.load().accessToken, 'at-prestado', 'borrar un token prestado no borra nada')

  assert.throws(() => store.save({ accessToken: 'otro' }), PimiaError)
})
