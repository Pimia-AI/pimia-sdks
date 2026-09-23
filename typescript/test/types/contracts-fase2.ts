import type {
  ContractBillingMode,
  ContractDocumentPreview,
  ContractModelBlock,
  ContractModelRequest,
  ContractModelResource,
  ContractModelVariable,
  ContractRequest,
  ContractSignatureRequest,
  PimiaClient,
} from '../../dist/index.js'
import { CONTRACT_BILLING_MODES, contractDocumentBlockers } from '../../dist/index.js'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T

// Los cuatro modos son un enum cerrado del spec, no una cadena cualquiera.
type Modos = Assert<Equal<ContractBillingMode, 'INSTALLMENTS' | 'MILESTONES' | 'ONE_OFF' | 'NONE'>>
type ModosConst = Assert<Equal<(typeof CONTRACT_BILLING_MODES)[number], ContractBillingMode>>

async function ficha(client: PimiaClient) {
  // INSTALLMENTS: la cuota y la periodicidad son datos reales aquí.
  await client.contracts.create({
    title: 'Mantenimiento',
    customer_id: 5,
    starts_at: '2026-10-01',
    billing_mode: 'INSTALLMENTS',
    amount: 12000,
    billing_every: 'MONTHLY',
  })

  // MILESTONES: total opcional, hitos ordenados en céntimos, proyecto y modelo.
  const porHitos: ContractRequest = {
    title: 'Reforma',
    customer_id: 5,
    starts_at: '2026-10-01',
    billing_mode: 'MILESTONES',
    total_amount: 450000,
    project_id: 11,
    contract_model_version_id: 9,
    milestones: [
      { description: 'Fase 1', amount: 150000, planned_date: '2026-11-01', position: 1 },
      { description: 'Fase 2', amount: 300000, planned_date: null },
    ],
  }
  await client.contracts.create(porHitos)

  // ONE_OFF y NONE: sin cuota ni periodicidad.
  await client.contracts.create({ title: 'Peritaje', customer_id: 5, starts_at: '2026-10-01', billing_mode: 'ONE_OFF', total_amount: 90000 })
  await client.contracts.create({ title: 'Confidencialidad', customer_id: 5, starts_at: '2026-10-01', billing_mode: 'NONE' })

  // @ts-expect-error El importe va en céntimos ENTEROS, nunca en euros con coma.
  await client.contracts.create({ title: 'x', customer_id: 5, starts_at: '2026-10-01', amount: '120,00' })
  // @ts-expect-error Un quinto modo no existe.
  await client.contracts.create({ title: 'x', customer_id: 5, starts_at: '2026-10-01', billing_mode: 'HOURLY' })
  // @ts-expect-error Un hito sin importe no es un hito.
  await client.contracts.create({ title: 'x', customer_id: 5, starts_at: '2026-10-01', milestones: [{ description: 'Fase 1' }] })
  // @ts-expect-error El cliente sigue siendo obligatorio en los cuatro modos.
  await client.contracts.create({ title: 'x', starts_at: '2026-10-01', billing_mode: 'NONE' })

  const leido = await client.contracts.get(7)
  // El modo viaja siempre; la cuota y el total son anulables y no se derivan.
  leido.data.billing_mode satisfies string
  leido.data.total_amount satisfies number | null
  leido.data.amount satisfies number | null
  leido.data.project_id satisfies number | null
  leido.data.contract_model_version_id satisfies number | null
  // Los hitos y las recurrentes están SIEMPRE: `[]` es «ninguna», no «no consta».
  leido.data.milestones[0]?.amount satisfies number | undefined
  leido.data.milestones[0]?.planned_date satisfies string | null | undefined
  leido.data.recurring_invoices.length satisfies number
}

async function catalogo(client: PimiaClient) {
  const bloques: ContractModelBlock[] = [
    { type: 'heading', level: 2, text: [{ type: 'text', value: 'Objeto', bold: true }] },
    { type: 'paragraph', text: [{ type: 'text', value: 'Entre ' }, { type: 'variable', key: 'customer.name' }] },
    { type: 'list', ordered: false, items: [[{ type: 'text', value: 'Revisión trimestral' }]] },
    { type: 'table', variable: 'contract.milestones' },
    { type: 'signature' },
  ]
  const cuerpo: ContractModelRequest = { name: 'Mantenimiento', content: bloques, draft_revision: 2 }

  const creado = await client.contracts.models.create(cuerpo)
  creado.data satisfies ContractModelResource
  creado.data.draft_content satisfies ContractModelBlock[] | null
  creado.data.draft_revision satisfies number

  const listado = await client.contracts.models.list({ status: 'ALL' })
  listado.data[0]?.name satisfies string | undefined

  const detalle = await client.contracts.models.get(4)
  // Los modos compatibles se deducen del texto y llegan como enum, no como string suelta.
  detalle.data.published_version?.compatible_modes satisfies ContractBillingMode[] | undefined
  detalle.data.published_version?.variables_used satisfies string[] | undefined
  detalle.data.versions?.[0]?.version_number satisfies number | undefined

  await client.contracts.models.publish(4)
  await client.contracts.models.archive(4)

  const diccionario = await client.contracts.models.variables({ billing_mode: 'MILESTONES' })
  const entrada: ContractModelVariable | undefined = diccionario.data[0]
  entrada?.modes satisfies ContractBillingMode[] | undefined
  entrada?.guarded satisfies boolean | undefined
  diccionario.meta.limits.max_blocks satisfies number
  diccionario.meta.block_types satisfies readonly string[]

  // @ts-expect-error El clausulado no es HTML ni texto libre.
  const invalido: ContractModelRequest = { name: 'x', content: '<p>hola</p>' }
  // @ts-expect-error Un bloque que el esquema no tiene no compila.
  const invalido2: ContractModelBlock = { type: 'image', src: 'x' }
  // @ts-expect-error El bloque de firma no lleva datos.
  const invalido3: ContractModelBlock = { type: 'signature', name: 'Ana' }
  // @ts-expect-error El diccionario se pide por modo, no por cadena libre.
  await client.contracts.models.variables({ billing_mode: 'HOURLY' })
  void invalido
  void invalido2
  void invalido3
}

async function revision(client: PimiaClient) {
  const vista: ContractDocumentPreview = await client.contracts.documentPreview(7, {
    name: 'Ana',
    email: 'ana@example.test',
  })
  vista.download_url satisfies string
  vista.data.reference satisfies string
  vista.data.source_document_sha256 satisfies string
  vista.data.anchored satisfies boolean
  vista.data.implicit_preview satisfies boolean
  // La caja esperada es un OBJETO: `page` existe y `.length` no.
  vista.data.expected_signature_field?.page satisfies number | undefined
  // @ts-expect-error No es una lista.
  vista.data.expected_signature_field?.length

  const bytes = await client.contracts.documentPreviewDownload(7, vista.data.reference)
  bytes satisfies Blob

  // La referencia del servidor es lo que se manda; no un hash del navegador.
  const envio: ContractSignatureRequest = {
    name: 'Ana',
    email: 'ana@example.test',
    document_version_id: vista.data.reference,
  }
  const enviado = await client.contracts.signature.send(7, envio)
  enviado.signingUrl satisfies string

  // Sigue siendo opcional: un contrato sin modelo se envía sin ella.
  await client.contracts.signature.send(7, { name: 'Ana', email: 'ana@example.test' })
  // @ts-expect-error La referencia es una cadena, no el id numérico de una fila.
  await client.contracts.signature.send(7, { name: 'Ana', email: 'ana@example.test', document_version_id: 12 })

  const motivos = contractDocumentBlockers(new Error('x'))
  motivos satisfies string[] | undefined
}

async function facturaManual(client: PimiaClient) {
  const creada = await client.invoices.create({
    customer_id: 5,
    invoice_date: '2026-11-02',
    due_date: '2026-11-30',
    contract_id: 7,
    items: [],
  })
  creada.data.contract_id satisfies number | null
}

void ficha
void catalogo
void revision
void facturaManual
