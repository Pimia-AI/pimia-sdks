/**
 * `TokenSet.tenantId`: el canje del AS del ápice dice a qué instancia
 * pertenece el token; el del tenant no lo manda y el campo no aparece.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { tokenSetFromResponse } from '../dist/tokens.js'

test('el canje del ápice trae la instancia; el del tenant, no', () => {
  const delApice = tokenSetFromResponse({ access_token: 'a', token_type: 'Bearer', tenant_id: 'talleres-ana' }, 0)
  assert.equal(delApice.tenantId, 'talleres-ana')

  const delTenant = tokenSetFromResponse({ access_token: 'a', token_type: 'Bearer' }, 0)
  assert.equal('tenantId' in delTenant, false)

  const vacio = tokenSetFromResponse({ access_token: 'a', tenant_id: '' }, 0)
  assert.equal('tenantId' in vacio, false)
})
