import type { PimiaClient, ContractSignatureRequest, ContractResource } from '../../dist/index.js'
import type { operations } from '../../dist/api.js'

type Signature = PimiaClient['contracts']['signature']
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T
// Comprobar igualdad impide que `never` pase por ser asignable a cualquier tipo.
type Send = Assert<Equal<Awaited<ReturnType<Signature['send']>>, operations['contract.sendContractForSignature']['responses'][200]['content']['application/json']>>
type Status = Assert<Equal<Awaited<ReturnType<Signature['status']>>, operations['contract.contractSignatureStatus']['responses'][200]['content']['application/json']>>
type Cancel = Assert<Equal<Awaited<ReturnType<Signature['cancel']>>, operations['contract.cancelContractSignature']['responses'][200]['content']['application/json']>>
type Remind = Assert<Equal<Awaited<ReturnType<Signature['remind']>>, operations['contract.remindContractSignature']['responses'][202]['content']['application/json']>>

async function consumer(client: PimiaClient) {
  const body: ContractSignatureRequest = { name: 'Ana', email: 'ana@example.test', send_email: false }
  const sent = await client.contracts.signature.send(7, body)
  sent.signingUrl satisfies string
  sent.data satisfies ContractResource
  const status = await client.contracts.signature.status('7')
  status.data.signature.signed_document_sha256 satisfies string | null
  // @ts-expect-error El enlace es una capacidad exclusiva de la respuesta de envío.
  status.signingUrl
  const cancelled = await client.contracts.signature.cancel(7)
  // @ts-expect-error Cancelar no devuelve la capacidad.
  cancelled.signingUrl
  const accepted = await client.contracts.signature.remind(7)
  accepted.success satisfies boolean
  // @ts-expect-error Un 202 de correo no devuelve contrato ni enlace.
  accepted.signingUrl
  // @ts-expect-error El destinatario exige email.
  client.contracts.signature.send(7, { name: 'Ana' })
  // @ts-expect-error send_email conserva el boolean del spec.
  client.contracts.signature.send(7, { name: 'Ana', email: 'ana@example.test', send_email: 'no' })
}
