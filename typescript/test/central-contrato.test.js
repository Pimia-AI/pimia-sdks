/**
 * El contrato central 1.19.0 en el cliente: los campos nuevos llegan tipados y
 * el enum de moneda del catálogo es cerrado. La comprobación es de TIPOS —el
 * spec no cambia el cableado HTTP—, así que se hace compilando un fichero de
 * asertos contra `dist/`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { PimiaCentralClient } from '../dist/index.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('el spec central versionado es el 1.19.0', () => {
  const spec = JSON.parse(readFileSync(new URL('../../spec/pimia-central-v1.json', import.meta.url), 'utf8'))
  assert.equal(spec.info.version, '1.19.0')
})

test('facturacion devuelve el desglose de asientos y la moneda del agregado', async () => {
  const cuerpo = {
    data: {
      asientos: [{ tenant_id: 'acme', rol: 'canal', precio_cents: 1200, moneda: 'EUR', en_mora: false, gracia_hasta: null, suspendido_desde: null }],
      anadidos: {
        activaciones: 2, total_cents: 2400, total: '24,00 €', moneda: 'EUR', monedas_mezcladas: false,
        asientos: 1, asientos_cents: 1200, asientos_total: '12,00 €', asientos_sin_precio: 0,
        por_tenant: [{ tenant_id: 'acme', activaciones: 2, total_cents: 2400, base_cents: 1200 }],
      },
    },
  }
  const calls = []
  const central = new PimiaCentralClient({
    baseUrl: 'https://pimia.test',
    token: 'token-ficticio',
    fetch: async (url, init) => (calls.push({ url: String(url), init }), json(cuerpo)),
  })

  const respuesta = await central.facturacion()
  assert.deepEqual(respuesta, cuerpo)
  assert.equal(calls[0].url, 'https://pimia.test/api/desarrollador/facturacion')
  assert.equal(respuesta.data.anadidos.moneda, 'EUR')
  assert.equal(respuesta.data.asientos[0].precio_cents, 1200)
})

test('con monedas mezcladas la moneda del agregado es null y la bandera lo dice', async () => {
  const central = new PimiaCentralClient({
    baseUrl: 'https://pimia.test',
    token: 'token-ficticio',
    fetch: async () => json({ data: { asientos: [], anadidos: { activaciones: 2, total_cents: 3000, total: '30,00', moneda: null, monedas_mezcladas: true, asientos: 0, asientos_cents: 0, asientos_total: '0,00', asientos_sin_precio: 0, por_tenant: [] } } }),
  })
  const { data } = await central.facturacion()
  assert.equal(data.anadidos.moneda, null)
  assert.equal(data.anadidos.monedas_mezcladas, true)
})

test('el catálogo trae el tramo mayorista y las activaciones su precio inicial', async () => {
  const tramo = { key: 'plata', name: 'Plata', discount_pct: '10.00', seats: 12, next: { key: 'oro', name: 'Oro', min_seats: 25, discount_pct: '15.00', seats_missing: 13 } }
  const central = new PimiaCentralClient({
    baseUrl: 'https://pimia.test',
    token: 'token-ficticio',
    fetch: async (url) =>
      String(url).endsWith('/catalogo')
        ? json({ data: { perfil: null, currency: 'EUR', items: [], disponibles: { base: [], modules: [], apps: [], wholesale_tier: tramo } } })
        : json({ data: { base: null, items: [{ kind: 'module', item: 'crm', active_since: '2026-09-01', price_cents: 900, price: '9,00 €', precio_inicial_cents: 700, precio_desde: '2026-09-15', cambio_de_precio: true }], total_cents: 900, total: '9,00 €' } }),
  })

  const catalogo = await central.catalogo.get()
  assert.deepEqual(catalogo.data.disponibles.wholesale_tier, tramo)

  const activaciones = await central.activaciones.list('acme')
  assert.equal(activaciones.data.items[0].precio_inicial_cents, 700)
  assert.equal(activaciones.data.items[0].cambio_de_precio, true)
})

test('la cartera dice qué tiene activado cada cliente, con nombre', async () => {
  const central = new PimiaCentralClient({
    baseUrl: 'https://pimia.test',
    token: 'token-ficticio',
    fetch: async () => json({ data: { cartera: [{ tenant_id: 'acme', activaciones: [{ kind: 'module', slug: 'crm', name: 'CRM' }] }], resumen: { total: 1 } } }),
  })
  const { data } = await central.overview()
  assert.deepEqual(data.cartera[0].activaciones, [{ kind: 'module', slug: 'crm', name: 'CRM' }])
})

test('los tipos públicos del contrato central 1.19.0 compilan', () => {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'test/types/central-contrato-1-19-0.ts'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
