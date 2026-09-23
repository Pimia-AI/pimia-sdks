#!/usr/bin/env node
/**
 * El recorrido entero de contratos fase 2, contra un tenant real.
 *
 *   PIMIA_BASE_URL=https://TENANT.taskai.work \
 *   PIMIA_TOKEN=... PIMIA_COMPANY=1 PIMIA_CUSTOMER_ID=5 \
 *   node examples/contratos-fase2/recorrido.mjs
 *
 * Qué hace, en este orden: redacta un modelo de clausulado, lo publica, crea
 * un contrato POR HITOS con proyecto que elige ESA versión, prepara la
 * revisión, descarga los bytes exactos, y —solo si le dices `--firmar`—
 * envía a firmar con la referencia. Al final crea una factura MANUAL vinculada
 * al contrato, que es como se cobra un hito.
 *
 * ⛔ Escribe de verdad. Los cuatro modos se enseñan al final SIN enviarlos:
 * el objetivo es ver la forma del cuerpo de cada uno, no llenar el tenant.
 * Y no firma nada sin `--firmar`, porque firmar manda un correo a una persona.
 */
import { PimiaClient, CONTRACT_BILLING_MODES, contractDocumentBlockers } from '@pimia/sdk'

const { PIMIA_BASE_URL, PIMIA_TOKEN, PIMIA_COMPANY, PIMIA_CUSTOMER_ID, PIMIA_PROJECT_ID } = process.env
const firmar = process.argv.includes('--firmar')

if (!PIMIA_BASE_URL || !PIMIA_TOKEN || !PIMIA_CUSTOMER_ID) {
  console.error('Faltan PIMIA_BASE_URL, PIMIA_TOKEN y PIMIA_CUSTOMER_ID.')
  process.exit(64)
}

const client = PimiaClient.withBorrowedToken({
  baseUrl: PIMIA_BASE_URL,
  accessToken: PIMIA_TOKEN,
  headers: PIMIA_COMPANY ? { company: PIMIA_COMPANY } : {},
})

// 1. El diccionario manda: el editor solo ofrece lo que ESTE modo tiene.
const { data: variables, meta } = await client.contracts.models.variables({ billing_mode: 'MILESTONES' })
console.log(`Diccionario v${meta.dictionary_version}: ${variables.length} marcadores para MILESTONES.`)
console.log(`Bloques permitidos: ${meta.block_types.join(', ')} · máx. ${meta.limits.max_blocks} bloques.`)

// 2. Un clausulado propio. Es un árbol de datos, no HTML: el servidor lo
//    valida entero y un marcador que no exista es un 422 con su nombre.
const { data: modelo } = await client.contracts.models.create({
  name: `Obra por hitos (ejemplo ${new Date().toISOString().slice(0, 10)})`,
  draft_revision: 0,
  content: [
    { type: 'heading', level: 1, text: [{ type: 'text', value: 'Contrato de obra' }] },
    {
      type: 'paragraph',
      text: [
        { type: 'text', value: 'Entre ' },
        { type: 'variable', key: 'company.name', bold: true },
        { type: 'text', value: ' y ' },
        { type: 'variable', key: 'customer.name', bold: true },
        { type: 'text', value: ', para la obra ' },
        { type: 'variable', key: 'project.name' },
        { type: 'text', value: ', por un total de ' },
        { type: 'variable', key: 'contract.total_amount' },
        { type: 'text', value: '.' },
      ],
    },
    { type: 'heading', level: 2, text: [{ type: 'text', value: 'Entregas previstas' }] },
    // Una tabla se rellena con un marcador de tipo `table`; hoy solo los hitos.
    { type: 'table', variable: 'contract.milestones' },
    // Dónde firma el cliente. Uno, ni cero ni dos.
    { type: 'signature' },
  ],
})
console.log(`Modelo ${modelo.id} en borrador, revisión ${modelo.draft_revision}.`)

// 3. Publicar lo congela: la versión es inmutable y los modos compatibles se
//    DEDUCEN del texto (este usa el total y los hitos, así que sale MILESTONES).
const { data: publicado } = await client.contracts.models.publish(modelo.id)
const version = publicado.published_version
console.log(`Publicada la v${version.version_number} (id ${version.id}); modos: ${version.compatible_modes.join(', ')}.`)

// 4. El contrato ELIGE esa versión. Publicar una v2 después no lo cambiará.
const { data: contrato } = await client.contracts.create({
  title: 'Reforma del local',
  customer_id: Number(PIMIA_CUSTOMER_ID),
  starts_at: new Date().toISOString().slice(0, 10),
  billing_mode: 'MILESTONES',
  total_amount: 450000, // céntimos: 4.500,00
  project_id: PIMIA_PROJECT_ID ? Number(PIMIA_PROJECT_ID) : null,
  contract_model_version_id: version.id,
  milestones: [
    { description: 'Fase 1 · demolición', amount: 150000, planned_date: '2026-11-01', position: 1 },
    { description: 'Fase 2 · acabados', amount: 300000, planned_date: null, position: 2 },
  ],
})
console.log(`Contrato ${contrato.id} (${contrato.billing_mode}) con ${contrato.milestones.length} hitos.`)
// En un contrato que no es de cuotas NO hay recurrentes, y `[]` lo dice.
console.log(`Recurrentes: ${contrato.recurring_invoices.length} — los hitos no emiten nada.`)

// 5. La revisión: el papel exacto. Prepararla no envía nada.
let revision
try {
  const vista = await client.contracts.documentPreview(contrato.id, {
    name: 'Ana Pérez',
    email: 'ana@example.test',
  })
  revision = vista.data
  console.log(`Revisión ${revision.reference} · ${revision.byte_size} bytes · sha256 ${revision.source_document_sha256.slice(0, 12)}…`)
  console.log(`Ancla: ${revision.anchored ? `página ${revision.expected_signature_field?.page}` : 'sin ancla'}`)

  // 6. Los MISMOS bytes, servidos del archivo. Nunca se regeneran.
  const pdf = await client.contracts.documentPreviewDownload(contrato.id, revision.reference)
  console.log(`PDF descargado: ${pdf.size} bytes (coincide: ${pdf.size === revision.byte_size}).`)
} catch (error) {
  const motivos = contractDocumentBlockers(error)
  if (!motivos) throw error
  // ⛔ Aquí NO se reintenta: falta un dato y lo arregla una persona.
  console.error('Bloqueado, y estos son TODOS los motivos:')
  for (const motivo of motivos) console.error(` · ${motivo}`)
  process.exit(1)
}

// 7. Firmar manda un correo a una persona: solo bajo petición explícita.
if (firmar) {
  const enviado = await client.contracts.signature.send(contrato.id, {
    name: 'Ana Pérez',
    email: 'ana@example.test',
    document_version_id: revision.reference, // la referencia del servidor, no un hash del navegador
  })
  console.log(`Enviado a firmar. signingUrl es una capacidad: no la registres. (${enviado.data.signature.status})`)
} else {
  console.log('Sin --firmar: no se envía nada. La vista previa no firma ni manda correos.')
}

// 8. El hito se cobra a mano, y la factura queda bajo el contrato.
const { data: factura } = await client.invoices.create({
  customer_id: Number(PIMIA_CUSTOMER_ID),
  invoice_date: new Date().toISOString().slice(0, 10),
  due_date: new Date().toISOString().slice(0, 10),
  contract_id: contrato.id,
  items: [{ name: 'Fase 1 · demolición', quantity: 1, price: 150000 }],
})
console.log(`Factura ${factura.id} vinculada al contrato ${factura.contract_id}.`)

// 9. Los cuatro modos, para verles la forma. No se envían.
const ejemplos = {
  INSTALLMENTS: { amount: 12000, billing_every: 'MONTHLY' }, // el ÚNICO que crea recurrente
  MILESTONES: { total_amount: 450000, milestones: [{ description: 'Fase 1', amount: 450000 }] },
  ONE_OFF: { total_amount: 90000 },
  NONE: {}, // un documento que se firma y ya
}
for (const modo of CONTRACT_BILLING_MODES) {
  console.log(`${modo}: ${JSON.stringify(ejemplos[modo])}`)
}
