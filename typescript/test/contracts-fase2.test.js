import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import {
  CONTRACT_BILLING_MODES,
  PimiaClient,
  PimiaApiError,
  contractDocumentBlockers,
} from '../dist/index.js'

/** Un cliente con transporte de mentira que apunta cada llamada. */
function clienteEspia(responder) {
  const calls = []
  const client = PimiaClient.withBorrowedToken({
    baseUrl: 'https://acme.pimia.es',
    accessToken: 'token-ficticio',
    headers: { company: '3' },
    fetch: async (url, init) => {
      calls.push({ url: String(url), init })
      return responder(calls.length)
    },
  })

  return { client, calls }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const modelo = {
  id: 4,
  company_id: 3,
  name: 'Mantenimiento',
  status: 'ACTIVE',
  draft_content: [{ type: 'paragraph', text: [{ type: 'text', value: 'Hola' }] }],
  draft_revision: 2,
  published_version_id: 9,
  seed_key: null,
  creator_id: 1,
  created_at: '2026-09-23T08:00:00+00:00',
  updated_at: '2026-09-23T09:00:00+00:00',
}

test('modelos: las siete operaciones conservan ruta, método y cuerpo', async () => {
  const { client, calls } = clienteEspia(() => json({ data: modelo }))
  const body = {
    name: 'Mantenimiento',
    draft_revision: 2,
    content: [
      { type: 'heading', level: 2, text: [{ type: 'text', value: 'Objeto', bold: true }] },
      { type: 'paragraph', text: [{ type: 'variable', key: 'customer.name' }] },
      { type: 'list', ordered: true, items: [[{ type: 'text', value: 'Uno' }]] },
      { type: 'table', variable: 'contract.milestones' },
      { type: 'signature' },
    ],
  }

  await client.contracts.models.list({ status: 'ALL', limit: 'all' })
  await client.contracts.models.get(4)
  await client.contracts.models.create(body, { idempotencyKey: 'modelo-alta' })
  await client.contracts.models.update(4, body)
  await client.contracts.models.publish('4')
  await client.contracts.models.archive(4)
  await client.contracts.models.variables({ billing_mode: 'MILESTONES' })

  assert.deepEqual(
    calls.map((c) => `${c.init.method} ${c.url}`),
    [
      'GET https://acme.pimia.es/api/v1/contract-models?status=ALL&limit=all',
      'GET https://acme.pimia.es/api/v1/contract-models/4',
      'POST https://acme.pimia.es/api/v1/contract-models',
      'PUT https://acme.pimia.es/api/v1/contract-models/4',
      'POST https://acme.pimia.es/api/v1/contract-models/4/publish',
      'POST https://acme.pimia.es/api/v1/contract-models/4/archive',
      'GET https://acme.pimia.es/api/v1/contract-models/variables?billing_mode=MILESTONES',
    ],
  )
  // El árbol viaja tal cual: el SDK no normaliza ni recorta el clausulado.
  assert.deepEqual(JSON.parse(calls[2].init.body), body)
  assert.deepEqual(JSON.parse(calls[3].init.body), body)
  assert.equal(calls[2].init.headers['idempotency-key'], 'modelo-alta')
  // Publicar y archivar no llevan cuerpo propio: la decisión es la acción.
  assert.deepEqual(JSON.parse(calls[4].init.body), {})
  assert.deepEqual(JSON.parse(calls[5].init.body), {})
  for (const call of calls) assert.equal(call.init.headers.company, '3')
})

test('modelos: el 409 de una revisión vieja llega tipado y no se reintenta', async () => {
  const conflicto = {
    success: false,
    message: 'Otra edición guardó este borrador mientras escribías (revisión 3, mandaste 2).',
  }
  const { client, calls } = clienteEspia(() => json(conflicto, 409))

  await assert.rejects(
    () => client.contracts.models.update(4, { name: 'x', draft_revision: 2, content: [] }),
    (error) => {
      assert.ok(error instanceof PimiaApiError)
      assert.equal(error.status, 409)
      assert.deepEqual(error.body, conflicto)
      // Un conflicto de edición no trae bloqueos de datos: son cosas distintas.
      assert.equal(contractDocumentBlockers(error), undefined)
      return true
    },
  )
  // Y el cliente no vuelve a intentarlo por su cuenta.
  assert.equal(calls.length, 1)
})

test('variables: el diccionario y su meta llegan sin tocar', async () => {
  const respuesta = {
    data: [
      {
        key: 'contract.total_amount',
        label: 'Importe total',
        type: 'money',
        format: 'currency',
        modes: ['MILESTONES', 'ONE_OFF'],
        required: true,
        empty_as: null,
        guarded: false,
        example: '4.500,00 €',
      },
      {
        key: 'project.name',
        label: 'Nombre de la obra',
        type: 'text',
        format: null,
        modes: CONTRACT_BILLING_MODES.slice(),
        required: true,
        empty_as: null,
        guarded: true,
        example: 'Reforma del local',
      },
    ],
    meta: {
      dictionary_version: '1',
      schema_version: '1',
      render_revision: '2026-09-23.2',
      block_types: ['heading', 'paragraph', 'list', 'table', 'signature'],
      inline_types: ['text', 'variable'],
      limits: {
        max_blocks: 300,
        max_inlines: 300,
        max_list_items: 200,
        max_text_length: 5000,
        max_bytes: 200000,
        max_heading_level: 3,
      },
    },
  }
  const { client } = clienteEspia(() => json(respuesta))

  const leido = await client.contracts.models.variables()

  assert.deepEqual(leido, respuesta)
  // Los límites vivos salen del servidor: el SDK no lleva una segunda copia.
  assert.equal(leido.meta.limits.max_blocks, 300)
  assert.deepEqual(leido.data[1].modes, ['INSTALLMENTS', 'MILESTONES', 'ONE_OFF', 'NONE'])
})

test('los cuatro modos viajan con los campos de SU modo y nada más', async () => {
  const { client, calls } = clienteEspia(() => json({ data: { id: 7 } }, 201))
  const base = { title: 'Obra', customer_id: 5, starts_at: '2026-10-01' }
  const cuerpos = [
    { ...base, billing_mode: 'INSTALLMENTS', amount: 12000, billing_every: 'MONTHLY' },
    {
      ...base,
      billing_mode: 'MILESTONES',
      total_amount: 450000,
      project_id: 11,
      contract_model_version_id: 9,
      milestones: [
        { description: 'Fase 1', amount: 150000, planned_date: '2026-11-01', position: 1 },
        { description: 'Fase 2', amount: 300000, planned_date: null, position: 2 },
      ],
    },
    { ...base, billing_mode: 'ONE_OFF', total_amount: 90000 },
    { ...base, billing_mode: 'NONE' },
  ]

  for (const cuerpo of cuerpos) await client.contracts.create(cuerpo)

  assert.equal(calls.length, 4)
  for (const [i, cuerpo] of cuerpos.entries()) {
    // Ni un céntimo inventado ni una periodicidad por defecto: lo que mandas
    // es lo que sale, y el núcleo rechaza lo ajeno al modo con un 422.
    assert.deepEqual(JSON.parse(calls[i].init.body), cuerpo)
  }
  // Los hitos conservan orden, nulos y céntimos enteros.
  const hitos = JSON.parse(calls[1].init.body).milestones
  assert.deepEqual(hitos.map((h) => h.position), [1, 2])
  assert.equal(hitos[1].planned_date, null)
  assert.equal(hitos[0].amount, 150000)
})

test('preview: prepara, descarga los MISMOS bytes y envía con la referencia', async () => {
  const revision = {
    reference: '01KX0ZPQ7Q2M3N4P5R6S7T8V9W',
    contract_id: 7,
    status: 'PREPARED',
    contract_model_version_id: 9,
    signature_version: null,
    locale: 'es',
    currency_code: 'EUR',
    date_format: 'd/m/Y',
    render_revision: '2026-09-23.2',
    anchored: true,
    source_document_sha256: 'a'.repeat(64),
    byte_size: 24576,
    signature_fields: null,
    expected_signature_field: { page: 2, page_count: 3, left: 12.5, top: 70.25, width: 40, height: 5 },
    implicit_preview: false,
    data_snapshot: { context: { locale: 'es' } },
    created_at: '2026-09-23T10:00:00+00:00',
  }
  const preparada = {
    data: revision,
    download_url: `https://acme.pimia.es/api/v1/contracts/7/document-preview/${revision.reference}`,
  }
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46])
  const { client, calls } = clienteEspia((n) => {
    if (n === 2) {
      return new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } })
    }
    return json(n === 3 ? { data: { id: 7 }, signingUrl: 'https://firma.example.test/x' } : preparada)
  })

  const vista = await client.contracts.documentPreview(7, { name: 'Ana', email: 'ana@example.test' })
  assert.deepEqual(vista, preparada)

  const bytes = await client.contracts.documentPreviewDownload(7, vista.data.reference)
  assert.ok(bytes instanceof Blob)
  assert.equal(bytes.size, 4)

  await client.contracts.signature.send(7, {
    name: 'Ana',
    email: 'ana@example.test',
    document_version_id: vista.data.reference,
  })

  assert.deepEqual(
    calls.map((c) => `${c.init.method} ${c.url}`),
    [
      'POST https://acme.pimia.es/api/v1/contracts/7/document-preview',
      `GET https://acme.pimia.es/api/v1/contracts/7/document-preview/${revision.reference}`,
      'POST https://acme.pimia.es/api/v1/contracts/7/signature',
    ],
  )
  // La descarga pide cualquier tipo: leer un PDF como JSON lo corrompe en silencio.
  assert.equal(calls[1].init.headers.accept, '*/*')
  // La referencia es la que devolvió el servidor, no un hash del navegador.
  assert.equal(JSON.parse(calls[2].init.body).document_version_id, revision.reference)
  // Y la preview no envía nada: la primera llamada no crea firma.
  assert.equal(calls[0].url.endsWith('/document-preview'), true)
})

test('preview sin cuerpo manda un objeto vacío, no la clave a null', async () => {
  const { client, calls } = clienteEspia(() => json({ data: { reference: 'r' }, download_url: 'u' }))

  await client.contracts.documentPreview('7')

  assert.deepEqual(JSON.parse(calls[0].init.body), {})
})

test('un bloqueo llega con TODOS los motivos y sin reintento automático', async () => {
  const bloqueo = {
    success: false,
    message: 'El documento no se puede preparar porque faltan datos: …',
    blockers: [
      'El marcador «customer.tax_id» (NIF del cliente) no tiene valor en este contrato.',
      'El marcador «contract.total_amount» (Importe total) no tiene valor en este contrato.',
    ],
  }
  const { client, calls } = clienteEspia(() => json(bloqueo, 422))

  await assert.rejects(
    () => client.contracts.documentPreview(7),
    (error) => {
      assert.deepEqual(contractDocumentBlockers(error), bloqueo.blockers)
      assert.equal(contractDocumentBlockers(error).length, 2)
      return true
    },
  )
  assert.equal(calls.length, 1, 'un bloqueo no se reintenta: hornearía otro PDF')

  // Y lo que no trae bloqueos no se los inventa.
  assert.equal(contractDocumentBlockers(new PimiaApiError(422, 'x', { message: 'x' })), undefined)
  assert.deepEqual(contractDocumentBlockers({ blockers: ['uno'] }), ['uno'])
  assert.equal(contractDocumentBlockers({ blockers: [1, 2] }), undefined)
  assert.equal(contractDocumentBlockers(null), undefined)
})

test('una revisión obsoleta al enviar se propaga tal cual: no se prepara otra', async () => {
  const obsoleta = {
    success: false,
    message: 'La revisión que mandas ya no es la vigente de este contrato.',
    blockers: ['Los datos del contrato cambiaron desde que se preparó el papel. Vuelve a revisarlo.'],
  }
  const { client, calls } = clienteEspia(() => json(obsoleta, 422))

  await assert.rejects(
    () =>
      client.contracts.signature.send(7, {
        name: 'Ana',
        email: 'ana@example.test',
        document_version_id: 'referencia-vieja',
      }),
    (error) => {
      assert.deepEqual(contractDocumentBlockers(error), obsoleta.blockers)
      return true
    },
  )
  // Ni preview nueva ni reenvío: una sola llamada, la que falló.
  assert.equal(calls.length, 1)
})

test('una factura manual se vincula a su contrato por `contract_id`', async () => {
  const { client, calls } = clienteEspia(() => json({ data: { id: 31, contract_id: 7 } }))

  const creada = await client.invoices.create({
    customer_id: 5,
    invoice_date: '2026-11-02',
    due_date: '2026-11-30',
    contract_id: 7,
    items: [],
  })

  assert.equal(creada.data.contract_id, 7)
  assert.equal(JSON.parse(calls[0].init.body).contract_id, 7)
})

test('contratos fase 2: los tipos públicos aguantan `tsc --strict`', () => {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      'test/types/contracts-fase2.ts',
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
