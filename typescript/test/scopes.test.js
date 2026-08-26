/**
 * Guardarraíl de deriva entre `SCOPES` y el catálogo que publica el contrato.
 *
 * `SCOPES` se escribe a mano y el catálogo del Authorization Server crece por su
 * cuenta: la 0.6.0 ya tuvo que añadir cinco que faltaban, y la 0.10.0 otros
 * cuatro —`settings:write` entre ellos, que es justo lo que `PUT /me` exige
 * desde que dejó de ser operación de dueño—. Nada avisaba; se descubría al
 * necesitarlo.
 *
 * Lo que se compara es el flow del spec commiteado, así que este test es el
 * hermano de la guarda de deriva spec↔`api.ts` de la CI.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { SCOPES } from '../dist/index.js'

const spec = JSON.parse(
  readFileSync(new URL('../../spec/pimia-api-v1.json', import.meta.url), 'utf8'),
)

const publicados = Object.keys(
  spec.components.securitySchemes.oauth2.flows.authorizationCode.scopes,
)

/**
 * Los que el flow publica y un integrador NO puede pedir: el catálogo los emite
 * con `first_party_only`, o sea solo al client del panel web de Pimia. Salen en
 * el documento porque hay operaciones publicadas que los declaran (la marca
 * `x-pimia-partner-availability: first-party-only`), no porque estén a mano.
 *
 * La lista es explícita a propósito: si el núcleo añade un scope nuevo, este
 * test se pone rojo y hay que DECIDIR de qué lado cae, en vez de que se cuele
 * o se quede fuera sin que nadie lo mire.
 */
const RESERVADOS_A_LA_PRIMERA_PARTE = [
  'admin:read',
  'admin:write',
  'delegation:read',
  'delegation:write',
  // La capa B de VeriFactu (2026-08-27, factSaas#543): configuración de un
  // servicio externo con credencial y certificado de firma, con el criterio
  // de `admin`. Un integrador ve las cuatro operaciones en el spec pero no
  // puede pedir el scope.
  'verifactu:read',
  'verifactu:write',
]

test('SCOPES ofrece todo lo que un integrador puede pedir', () => {
  const ofrecidos = new Set(Object.values(SCOPES))
  const esperados = publicados.filter(
    (s) => !RESERVADOS_A_LA_PRIMERA_PARTE.includes(s),
  )

  const faltan = esperados.filter((s) => !ofrecidos.has(s))
  assert.deepEqual(faltan, [], `SCOPES no ofrece: ${faltan.join(', ')}`)
})

test('SCOPES no ofrece nada que el contrato no publique', () => {
  const sobran = Object.values(SCOPES).filter((s) => !publicados.includes(s))

  // Incluido `approvals:submit`, que es un alias del mismo permiso que
  // `approvals:write`: el catálogo lo publica con nombre propio.
  assert.deepEqual(sobran, [], `SCOPES ofrece lo que nadie emite: ${sobran.join(', ')}`)
})

test('ningún scope reservado a la primera parte se ofrece como pedible', () => {
  const ofrecidos = new Set(Object.values(SCOPES))
  const colados = RESERVADOS_A_LA_PRIMERA_PARTE.filter((s) => ofrecidos.has(s))

  assert.deepEqual(colados, [], `SCOPES ofrece scopes reservados: ${colados.join(', ')}`)
})
