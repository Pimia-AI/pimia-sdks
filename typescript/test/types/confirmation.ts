import { PimiaCentralClient, isOwnerConfirmationRequired } from '../../dist/index.js'
import type { ApiSuccess, OwnerConfirmationRequired, OwnerConfirmationMailFailedCode, FacturaAClienteRetryCode, PrimerPeriodoConflictCode, CobroDeInstancia } from '../../dist/index.js'
import type { operations } from '../../dist/api.js'

const pending: OwnerConfirmationRequired = { code: 'owner_confirmation_required', message: 'Pendiente', data: { id: 1 } }
const mailCode: OwnerConfirmationMailFailedCode = 'owner_confirmation_mail_failed'
const retryCode: FacturaAClienteRetryCode = 'factura_no_reintentable'
const conflict: PrimerPeriodoConflictCode = 'primer_periodo_incompatible'
// @ts-expect-error El enum del núcleo es cerrado.
const invalid: PrimerPeriodoConflictCode = 'inventado'
const noCobro: CobroDeInstancia = null
const affected = ['users.store', 'users.update', 'users.delete', 'users.destroy', 'roles.update', 'roles.updateAbilities', 'gestoriaLink.request', 'gestoriaLink.revoke', 'desarrolladorLink.request', 'desarrolladorLink.revoke'] as const
// La asignación individual exige que ninguno de los diez resultados pierda el 202.
const accepted: { [K in typeof affected[number]]: ApiSuccess<K> } = {
  'users.store': pending, 'users.update': pending, 'users.delete': pending, 'users.destroy': pending,
  'roles.update': pending, 'roles.updateAbilities': pending,
  'gestoriaLink.request': pending, 'gestoriaLink.revoke': pending,
  'desarrolladorLink.request': pending, 'desarrolladorLink.revoke': pending,
}
async function consumer(client: PimiaCentralClient) {
  const result = await client.tenants.production('acme', { plan: 'pro' })
  // @ts-expect-error No hay enlace hasta estrechar el resultado.
  result.checkoutUrl
  if (result.estado === 'primer_periodo_pendiente') result.checkoutUrl satisfies string
  const transfer = await client.tenants.transferOwnership('acme', { user_id: 1 })
  if (isOwnerConfirmationRequired(transfer)) transfer.data.id satisfies number
  // @ts-expect-error Un pendiente no tiene la forma del traspaso completado.
  const done: operations['users.store']['responses'][201]['content']['application/json'] = pending
  const retry = await client.facturasAClientes.retry(1)
  retry.data.id satisfies number
  retry.data.estado satisfies string
}
