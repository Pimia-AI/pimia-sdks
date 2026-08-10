/**
 * Tests del verificador de webhooks.
 *
 * El eje es el VECTOR DORADO de abajo: una entrega firmada con la misma
 * definición de canónico que usa el emisor del core (WebhookSigner.php), con
 * acentos y una barra en el cuerpo para que cualquier reescape de UTF-8 o de
 * `/` rompa el test. El mismo vector está fijado en el SDK de PHP
 * (php/tests/WebhookVerifierTest.php): si los dos lo aceptan, los dos
 * reconstruyen el canónico igual.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { WebhookVerificationError, signWebhook, verifyWebhook } from '../dist/index.js'

// Vector dorado. La firma se calculó aparte con node:crypto sobre
// ['PIMIA-WEBHOOK-v1', ts, evento, entrega, cuerpo].join('\n') — otra
// implementación distinta de la del SDK, que usa WebCrypto.
const ORO = {
  secret: 'whsec_prueba_del_vector_dorado',
  timestamp: 1786000000,
  event: 'invoice.paid',
  delivery: '918273',
  body: '{"id":42,"number":"FAC-2026/0007","status":"COMPLETED","paid_status":"PAID","is_credit_note":false,"customer_id":7,"company_id":1,"total":121000,"due_amount":0,"currency_id":1,"paid_at":"2026-08-10T12:34:56+02:00","nota":"Café con leche · 50% dto."}',
  signature: 'sha256=5721ac76ed1acb6f509713027533c29442361485690f175591ab99f21876e86c',
}

/** Cabeceras del vector, con los retoques que pida el test. */
function cabeceras(cambios = {}) {
  return {
    'x-pimia-signature': ORO.signature,
    'x-pimia-timestamp': String(ORO.timestamp),
    'x-pimia-event': ORO.event,
    'x-pimia-delivery': ORO.delivery,
    ...cambios,
  }
}

/** Reloj congelado dentro de la ventana del vector. */
const ahora = () => ORO.timestamp

function verificar(opciones = {}) {
  return verifyWebhook({
    secret: ORO.secret,
    headers: cabeceras(opciones.headers),
    body: opciones.body ?? ORO.body,
    now: ahora,
    ...(opciones.rest ?? {}),
  })
}

/** Comprueba que la promesa rechaza con este `reason` concreto. */
async function rechazaCon(promesa, reason) {
  await assert.rejects(promesa, (error) => {
    assert.ok(error instanceof WebhookVerificationError, `no es WebhookVerificationError: ${error}`)
    assert.equal(error.reason, reason)

    return true
  })
}

test('el vector dorado se verifica y devuelve el payload tipado', async () => {
  const hook = await verificar()

  assert.equal(hook.known, true)
  assert.equal(hook.event, 'invoice.paid')
  assert.equal(hook.delivery, '918273')
  assert.equal(hook.timestamp, ORO.timestamp)
  assert.equal(hook.payload.id, 42)
  assert.equal(hook.payload.total, 121000)
  assert.equal(hook.payload.paid_status, 'PAID')
  // Los acentos y el `·` sobreviven al viaje por bytes.
  assert.equal(hook.payload.nota, 'Café con leche · 50% dto.')
})

test('el cuerpo vale igual como bytes que como cadena', async () => {
  const bytes = new TextEncoder().encode(ORO.body)
  const hook = await verificar({ body: bytes })

  assert.equal(hook.payload.id, 42)

  // Y como ArrayBuffer, que es lo que da `await request.arrayBuffer()`.
  const desdeArrayBuffer = await verificar({ body: bytes.buffer })
  assert.equal(desdeArrayBuffer.payload.id, 42)
})

test('reserializar el cuerpo rompe la firma — la trampa que este módulo evita', async () => {
  // Mismo objeto, otros bytes: es lo que pasa si el receptor usa express.json()
  // y vuelve a serializar lo parseado.
  const reserializado = JSON.stringify(JSON.parse(ORO.body), null, 2)

  await rechazaCon(verificar({ body: reserializado }), 'signature_mismatch')
})

test('faltar cualquiera de las cuatro cabeceras es un rechazo, no un cuelgue', async () => {
  for (const cabecera of [
    'x-pimia-signature',
    'x-pimia-timestamp',
    'x-pimia-event',
    'x-pimia-delivery',
  ]) {
    await rechazaCon(verificar({ headers: { [cabecera]: undefined } }), 'missing_headers')
  }
})

test('un timestamp que no es número se rechaza sin dar por buena la firma', async () => {
  await rechazaCon(
    verificar({ headers: { 'x-pimia-timestamp': 'ayer' } }),
    'invalid_timestamp',
  )
})

test('fuera de la ventana anti-replay se rechaza, por viejo y por futuro', async () => {
  // Una entrega capturada y reenviada seis minutos después.
  await rechazaCon(
    verifyWebhook({
      secret: ORO.secret,
      headers: cabeceras(),
      body: ORO.body,
      now: () => ORO.timestamp + 360,
    }),
    'timestamp_out_of_window',
  )

  // Y con el reloj del receptor atrasado: el desfase es en valor absoluto.
  await rechazaCon(
    verifyWebhook({
      secret: ORO.secret,
      headers: cabeceras(),
      body: ORO.body,
      now: () => ORO.timestamp - 360,
    }),
    'timestamp_out_of_window',
  )

  // Justo en el borde (300s) todavía entra.
  const hook = await verifyWebhook({
    secret: ORO.secret,
    headers: cabeceras(),
    body: ORO.body,
    now: () => ORO.timestamp + 300,
  })
  assert.equal(hook.known, true)
})

test('la tolerancia es configurable para relojes que no van finos', async () => {
  const hook = await verifyWebhook({
    secret: ORO.secret,
    headers: cabeceras(),
    body: ORO.body,
    toleranceSeconds: 900,
    now: () => ORO.timestamp + 600,
  })

  assert.equal(hook.event, 'invoice.paid')
})

test('una firma manipulada no cuela, mida lo que mida', async () => {
  // Mismo largo, un carácter cambiado: el caso que `===` sí detectaría pero
  // filtrando el tiempo. Aquí solo comprobamos que se rechaza.
  const alterada = ORO.signature.slice(0, -1) + (ORO.signature.endsWith('c') ? 'd' : 'c')
  await rechazaCon(verificar({ headers: { 'x-pimia-signature': alterada } }), 'signature_mismatch')

  // Largo distinto: no debe reventar en la comparación.
  await rechazaCon(verificar({ headers: { 'x-pimia-signature': 'sha256=00' } }), 'signature_mismatch')

  // Sin el prefijo del algoritmo tampoco vale.
  await rechazaCon(
    verificar({ headers: { 'x-pimia-signature': ORO.signature.replace('sha256=', '') } }),
    'signature_mismatch',
  )
})

test('el secreto equivocado se rechaza', async () => {
  await rechazaCon(
    verifyWebhook({
      secret: 'whsec_otro',
      headers: cabeceras(),
      body: ORO.body,
      now: ahora,
    }),
    'signature_mismatch',
  )
})

test('una lista de secretos permite rotar sin ventana de caída', async () => {
  const hook = await verifyWebhook({
    secret: ['whsec_el_nuevo_que_aun_no_esta_en_el_panel', ORO.secret],
    headers: cabeceras(),
    body: ORO.body,
    now: ahora,
  })

  assert.equal(hook.event, 'invoice.paid')

  // Y si ninguno vale, sigue siendo un rechazo.
  await rechazaCon(
    verifyWebhook({
      secret: ['whsec_uno', 'whsec_dos'],
      headers: cabeceras(),
      body: ORO.body,
      now: ahora,
    }),
    'signature_mismatch',
  )
})

test('un evento que este SDK no conoce se verifica igual y llega con known:false', async () => {
  // El catálogo del servidor puede crecer sin que el partner actualice el SDK:
  // eso no puede convertirse en un 400.
  const cuerpo = '{"id":1,"algo":"nuevo"}'
  const headers = await signWebhook({
    secret: ORO.secret,
    event: 'invoice.overdue',
    deliveryId: 5,
    body: cuerpo,
    timestamp: ORO.timestamp,
  })

  const hook = await verifyWebhook({ secret: ORO.secret, headers, body: cuerpo, now: ahora })

  assert.equal(hook.known, false)
  assert.equal(hook.event, 'invoice.overdue')
  assert.equal(hook.delivery, '5')
  assert.deepEqual(hook.payload, { id: 1, algo: 'nuevo' })
})

test('los ocho eventos del catálogo llegan como known:true', async () => {
  const catalogo = [
    'approval.decided',
    'invoice.received',
    'app.revoked',
    'customer.created',
    'customer.updated',
    'invoice.created',
    'estimate.accepted',
    'invoice.paid',
  ]

  for (const evento of catalogo) {
    const cuerpo = '{"id":1}'
    const headers = await signWebhook({
      secret: ORO.secret,
      event: evento,
      deliveryId: 1,
      body: cuerpo,
      timestamp: ORO.timestamp,
    })

    const hook = await verifyWebhook({ secret: ORO.secret, headers, body: cuerpo, now: ahora })
    assert.equal(hook.known, true, `${evento} debería estar en el catálogo`)
    assert.equal(hook.event, evento)
  }
})

test('firma válida pero cuerpo que no es JSON: se distingue del resto', async () => {
  const cuerpo = 'esto no es json'
  const headers = await signWebhook({
    secret: ORO.secret,
    event: 'invoice.paid',
    deliveryId: 9,
    body: cuerpo,
    timestamp: ORO.timestamp,
  })

  await rechazaCon(
    verifyWebhook({ secret: ORO.secret, headers, body: cuerpo, now: ahora }),
    'invalid_json',
  )
})

test('las cabeceras se leen de un Headers, de un objeto de Node o de un Map', async () => {
  const esperado = { known: true, event: 'invoice.paid' }

  const conHeaders = await verifyWebhook({
    secret: ORO.secret,
    headers: new Headers(cabeceras()),
    body: ORO.body,
    now: ahora,
  })
  assert.equal(conHeaders.event, esperado.event)

  // Node entrega los nombres en minúsculas, pero un proxy puede no hacerlo.
  const conMayusculas = await verifyWebhook({
    secret: ORO.secret,
    headers: {
      'X-Pimia-Signature': ORO.signature,
      'X-Pimia-Timestamp': String(ORO.timestamp),
      'X-Pimia-Event': ORO.event,
      'X-Pimia-Delivery': ORO.delivery,
    },
    body: ORO.body,
    now: ahora,
  })
  assert.equal(conMayusculas.event, esperado.event)

  // Cabecera repetida: `req.headers` la da como array.
  const conArray = await verifyWebhook({
    secret: ORO.secret,
    headers: cabeceras({ 'x-pimia-delivery': [ORO.delivery, '999'] }),
    body: ORO.body,
    now: ahora,
  })
  assert.equal(conArray.delivery, ORO.delivery)

  const conMap = await verifyWebhook({
    secret: ORO.secret,
    headers: new Map(Object.entries(cabeceras())),
    body: ORO.body,
    now: ahora,
  })
  assert.equal(conMap.event, esperado.event)
})

test('signWebhook produce exactamente lo que verifyWebhook espera', async () => {
  const cuerpo = JSON.stringify({ id: 7, nota: 'ñandú' })
  const headers = await signWebhook({
    secret: ORO.secret,
    event: 'estimate.accepted',
    deliveryId: 4242,
    body: cuerpo,
  })

  const hook = await verifyWebhook({ secret: ORO.secret, headers, body: cuerpo })

  assert.equal(hook.known, true)
  assert.equal(hook.event, 'estimate.accepted')
  assert.equal(hook.delivery, '4242')
  assert.equal(hook.payload.nota, 'ñandú')
})

test('signWebhook reproduce el vector dorado byte a byte', async () => {
  const headers = await signWebhook({
    secret: ORO.secret,
    event: ORO.event,
    deliveryId: ORO.delivery,
    body: ORO.body,
    timestamp: ORO.timestamp,
  })

  assert.equal(headers['x-pimia-signature'], ORO.signature)
  assert.equal(headers['x-pimia-timestamp'], String(ORO.timestamp))
  assert.equal(headers['x-pimia-event'], ORO.event)
  assert.equal(headers['x-pimia-delivery'], ORO.delivery)
})
