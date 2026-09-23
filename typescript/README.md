# @pimia/sdk

`baseUrl` es el **origen**, sin `/api` ni barra final: `https://pimia.es`
para el cliente central o `https://acme.pimia.es` para el de instancia.
El cliente añade `/api/…` (central, TypeScript) o `/api/v1/…` (instancia).
Desde 0.30.1, un valor terminado en `/api` o `/api/v1` se rechaza al construir
el cliente (en PHP, al crear `Config`), antes de hacer peticiones. Quita ese
sufijo; no se elimina automáticamente. Una barra final sigue admitiéndose.


Cliente TypeScript oficial de la API de Pimia para **apps de partner**: OAuth
con PKCE, **rotación del refresh token** persistida, reintentos de rate limit y
tipos generados del OpenAPI. Licencia MIT.

Requisitos: Node ≥ 20 (o cualquier runtime con `fetch` y WebCrypto global).

## Instalación

```bash
npm install @pimia/sdk
```

Publicado desde v0.1.0, con
[provenance SLSA](https://docs.npmjs.com/generating-provenance-statements)
firmada por el workflow de release: el tarball es verificablemente
[este repositorio](https://github.com/Pimia-AI/pimia-sdks).

## Uso en 20 líneas

```ts
import { OAuth, PimiaClient, MemoryTokenStore, SCOPES, createPkceChallenge, createState } from '@pimia/sdk'

const config = {
  baseUrl: 'https://acme.pimia.es',
  clientId: process.env.PIMIA_CLIENT_ID!,
  clientSecret: process.env.PIMIA_CLIENT_SECRET, // solo app server-side
  redirectUri: 'https://miapp.example/callback',
}

// 1. Mandas al usuario a autorizar (guarda verifier y state en su sesión)
const pkce = await createPkceChallenge()
const state = createState()
const url = new OAuth(config).buildAuthorizeUrl({
  scopes: [SCOPES.invoicesRead, SCOPES.customersRead],
  state,
  pkce,
})

// 2. En tu callback: canjeas el code y guardas los tokens en TU store
const tokens = new MemoryTokenStore() // en producción: tu BD
tokens.save(await new OAuth(config).exchangeCode(code, pkce))

// 3. A partir de aquí, el cliente refresca y reintenta solo
const pimia = new PimiaClient({ ...config, tokens })
const invoices = await pimia.invoices.list({ page: 1 })
```

Los tipos de todos los endpoints salen del OpenAPI:

```ts
import type { paths } from '@pimia/sdk/api'

type Invoice = paths['/invoices/{id}']['get']['responses'][200]['content']['application/json']
```

## Lo único que tienes que leer antes de escribir código

**El refresh token de Pimia rota.** Cada refresco devuelve uno nuevo y mata el
anterior; reusar uno ya rotado revoca el grant entero en cascada. Por eso el
cliente exige un `TokenStore` en lugar de un string: persiste el conjunto de
tokens tras cada refresco y no refresques dos veces en paralelo con el mismo
token. Las dos cosas las cubre el SDK si lo usas como está pensado.

## Un servicio que reenvía el token de su usuario

Todo lo de arriba supone que **tu app posee un grant**. Hay integraciones que no
y que no deben: un servicio al que el front le manda, en cada petición, el
`Authorization` del usuario que ya entró en Pimia. Para ésas está el modo de
token prestado — sin `clientId`, sin `TokenStore` y sin ceremonia OAuth:

```ts
const pimia = PimiaClient.withBorrowedToken({
  baseUrl: `https://${tenant}.pimia.es`,
  accessToken: bearerDeQuienLlama,
  // La empresa activa viaja en cabecera, como en todo el API. OMÍTELA cuando no
  // la sepas: `company:` vacía es una cabecera presente que no casa con ninguna
  // empresa.
  headers: empresa === null ? {} : { company: String(empresa) },
  // Atiendes una petición web: los reintentos del SDK ESPERAN, y esperar dentro
  // de la petición de un usuario es una petición colgada.
  maxRateLimitRetries: 0,
})

const empresaActiva = await pimia.bootstrap.currentCompanyId()
const censo = await pimia.crm.assignableUsers()
```

Lo que ganas con esto es que **Pimia sigue decidiendo los permisos**: tu servicio
no puede darle a nadie más de lo que su token ya le daba, y no hay una
credencial de servicio que auditar aparte.

Tres cosas que conviene tener claras:

- **Un cliente por petición.** El token vive lo que viva la petición que lo
  trajo; una instancia compartida es una credencial compartida.
- **No se refresca.** El refresh es del dueño del grant. Cuando el token caduca,
  el 401 sube como `UnauthorizedError` y quien tiene que conseguir otro es quien
  te lo prestó. El cliente no lo intenta —y eso es deliberado: con la rotación
  de Pimia, tocar el refresh de otro revoca su grant entero.
- **`pimia.oauth` es `null`** en este modo. No hay ceremonia que hacer, y un
  `OAuth` sin `clientId` compondría una URL de autorización rota que sólo
  fallaría en el navegador del usuario.

`GET /bootstrap` merece un aviso propio: **es la única respuesta del API que no
viene envuelta en `data`**. Sus claves cuelgan de la raíz, así que un
desenvolvedor de `data` escrito «para todas las llamadas» devuelve vacío sin
error — y el fallo se ve como una empresa sin resolver o como una moneda que cae
al respaldo, nunca como un fallo. `pimia.bootstrap.currentCompanyId()` y
`.currency()` lo leen bien; `.get()` te da el cuerpo tal cual.

## Reintentar un `POST` sin duplicar

Manda una `Idempotency-Key` única por operación y Pimia ejecuta la escritura
una sola vez, por muchos reintentos que haya:

```ts
const clave = crypto.randomUUID()
await client.estimates.create(presupuesto, { idempotencyKey: clave })
```

Reúsala **solo** en los reintentos de esa misma operación: la misma clave con
otro cuerpo responde `422`.

Tras un reintento el cuerpo que recibes es idéntico al de la primera llamada
—ese es justo el contrato—, así que el cuerpo solo no dice si Pimia escribió o
se limitó a repetirse. Para saberlo, `requestWithMeta`:

```ts
const { data, meta } = await client.requestWithMeta('/estimates', {
  method: 'POST',
  body: presupuesto,
  idempotencyKey: clave,
})

if (meta.idempotentReplay) {
  // ya existía: no se ha creado nada nuevo
}
```

## Subir un fichero

Diez operaciones de la API son `multipart/form-data`: el justificante de un
gasto, el documento de una factura recibida, un extracto bancario, el membrete
de una plantilla, el certificado de firma, el avatar. Para ésas pásale un
`FormData` y el cliente lo manda tal cual — **no le pongas `content-type`**: el
runtime escribe el suyo con el `boundary` que separa las partes, y una cabecera
puesta a mano se lo quita (el cliente lo rechaza antes de salir, con un aviso
que lo explica).

`toFormData` hace las tres conversiones que el servidor espera y que `FormData`
sola no hace: los booleanos como `1`/`0`, los objetos y arrays como cadena
JSON, y los `null` omitidos en vez de mandados como la cadena `"null"`.

```ts
import { toFormData } from '@pimia/sdk'

// Un gasto con su justificante en PDF, de una sola llamada.
await client.post('/expenses', toFormData({
  expense_date: '2026-08-24',
  expense_category_id: 3,
  amount: 12100,                       // céntimos, como todo importe
  attachment_receipt: ficheroDelInput, // un File del navegador
  customFields: [{ id: 3, value: 'REF-42' }],
}))

// El documento de una factura recibida, con un Blob al que le das nombre.
const form = new FormData()
form.append('document', blobPdf, 'factura-proveedor.pdf')
await client.post(`/received-invoices/${id}/upload/document`, form)
```

Los campos de fichero salen tipados como `Blob` en `@pimia/sdk/api`, así que un
`File` del navegador encaja sin ceremonia.

⚠️ Lo que **no** puedes pasar es un `ReadableStream`: el cliente reintenta ante
un 401 y ante un 429, y un cuerpo de un solo uso no se puede volver a mandar.

## Descargar un fichero

Para las dos operaciones que devuelven un binario, `download`:

```ts
const pdf = await client.download(`/received-invoices/${id}/show/document`)
const url = URL.createObjectURL(pdf)
```

⚠️ **No uses `get()` para esto.** Lee la respuesta con `response.text()`, así
que un PDF llega entero de tamaño y no se abre — sin ningún error que mirar.

## Recibir webhooks

`verifyWebhook` comprueba la firma `PIMIA-WEBHOOK-v1` y te devuelve el evento
tipado. No reimplementes el HMAC:

```ts
import express from 'express'
import { verifyWebhook, WebhookVerificationError } from '@pimia/sdk'

// ⚠️ express.raw(), NO express.json(): Pimia firma los bytes que envía, y
// parsear + volver a serializar rompe la firma sin que se vea por qué.
app.post('/pimia', express.raw({ type: 'application/json' }), async (req, res) => {
  let hook

  try {
    hook = await verifyWebhook({
      secret: process.env.PIMIA_WEBHOOK_SECRET,
      headers: req.headers,
      body: req.body,
    })
  } catch (error) {
    return res.status(400).send((error as WebhookVerificationError).reason)
  }

  // Pimia reintenta: la misma entrega llega con el mismo `delivery`.
  // Procesar cada uno una sola vez es todo el exactly-once que necesitas.
  if (await yaProcesado(hook.delivery)) return res.sendStatus(200)

  if (hook.known) {
    switch (hook.event) {
      case 'estimate.accepted':
        await facturar(hook.payload.id) // payload tipado, sin castings
        break
      case 'invoice.paid':
        await cobrar(hook.payload.id)
        break
    }
  }

  res.sendStatus(200) // responde rápido; el trabajo pesado, a una cola
})
```

Los ocho eventos del catálogo (`approval.decided`, `invoice.received`,
`app.revoked`, `customer.created`, `customer.updated`, `invoice.created`,
`estimate.accepted`, `invoice.paid`) vienen tipados. Uno que este SDK todavía
no conozca **no es un error**: se verifica igual y llega con `known: false`.

Detalles que ahorran un rato:

- `secret` acepta una **lista** de secretos, para rotarlo sin ventana de caída.
- La ventana anti-replay son 300 s; ajústala con `toleranceSeconds`.
- Los errores traen un `reason` (`signature_mismatch`, `timestamp_out_of_window`,
  `missing_headers`, `invalid_timestamp`, `invalid_json`) para tus métricas.
- `signWebhook()` firma un cuerpo como lo haría Pimia: úsalo en **tus tests**,
  no en producción.

## El plano central: la cartera del integrador

Si eres integrador (una cuenta de **desarrollador** en Pimia), tu cartera, tus
clients OAuth, las invitaciones, el patrocinio y el traspaso viven en el
**plano central** (`baseUrl: https://pimia.es`; llamadas bajo `/api/…`), no en la API de un tenant. Es otro
cliente y otra credencial: el **token personal** de tu cuenta, no un token
OAuth de instancia.

```ts
import { PimiaCentralClient, MissingAbilityError } from '@pimia/sdk'

const central = new PimiaCentralClient({
  baseUrl: 'https://pimia.es',
  token: () => process.env.PIMIA_CENTRAL_TOKEN!,
})

const { data } = await central.overview()          // tu cartera, con la atribución
await central.invitations.create({                  // el cliente nace dueño; pagas tú
  email: 'ana@talleres-ana.es',
  company_name: 'Talleres Ana',
  billing: 'sponsor',
})
await central.sponsorship.sponsor({ tenant_slug: 'talleres-ana', plan_id: 6 })
```

El token está acotado por plano: `desarrollador` abre `/desarrollador/*` y
`central` abre invitaciones, patrocinio y traspaso. Si al tuyo le falta una,
la llamada lanza `MissingAbilityError` con `ability` diciendo cuál. Lo que el
plano central NO da es contenido fiscal de ningún cliente: a los datos de una
instancia se llega por OAuth consentido, con `PimiaClient`.

Tu correo y tu Stripe propios (contrato central 1.15.0, habilidad
`desarrollador`):

```ts
import { PimiaApiError, RateLimitError, type StripeCorteCode } from '@pimia/sdk'

// Las invitaciones que mandas salen desde tu servidor de correo.
await central.correo.update({
  mail_driver: 'smtp',
  from_name: 'ERP Studio',
  from_mail: 'hola@erpstudio.es',
  mail_host: 'smtp.erpstudio.es',
  mail_port: '587',
  mail_username: 'hola@erpstudio.es',
  mail_password: process.env.SMTP_PASSWORD!,
})
const prueba = await central.correo.test({ to: 'yo@erpstudio.es' })
if (!prueba.success) console.warn(prueba.error, prueba.reason) // 200 siempre: no lanza

// Tu cuenta de Stripe, independiente de la facturación de Pimia.
try {
  const { data } = await central.stripe.update({
    publishable_key: 'pk_live_…',
    secret_key: process.env.STRIPE_SECRET_KEY!,
    mode: 'live',
  })
  console.log(data.webhook_url) // dala de alta a mano en Stripe y guarda su whsec_
} catch (error) {
  if (error instanceof RateLimitError) {
    // stripe_too_many_attempts o el límite de 10 PUT/minuto: espera error.retryAfter
  } else if (error instanceof PimiaApiError) {
    const code = error.code as StripeCorteCode | undefined // stripe_key_invalid, stripe_mode_mismatch…
  }
}
```

`error.code` es el código de corte del cuerpo (`code`, o `error`): compara eso,
no el `message`. El receptor `POST /stripe/integrador/{opaco}` no es un método:
lo llama Stripe, firmado.

«Facturo con Pimia»: la factura de lo que cobras a tus clientes con tu Stripe
(contrato central 1.16.0, habilidad `desarrollador`):

```ts
const { data: ajustes } = await central.facturacionAClientes.get() // emisoras elegibles, tipo_iva como texto
await central.facturacionAClientes.update({
  factura_con_pimia: true,
  tenant_emisor_id: ajustes.emisoras[0]!.id,
  tipo_iva: 21,
})

// Una página (hasta 50) con list(), o todas siguiendo next_cursor con iterate():
for await (const f of central.facturasAClientes.iterate({ estado: 'pendiente_sin_nif' })) {
  // corrige el NIF del cliente y vuelve a encolarla (solo error y pendiente_sin_nif; lo demás, 409)
  await central.facturasAClientes.retry(f.id)
}
```

Lo que cuesta tu canal, tramo a tramo (contrato central **1.19.0**):

```ts
const { data } = await central.facturacion()
// ⛔ Antes de enseñar el total, mira si mezcla monedas: con activaciones en
// monedas distintas `moneda` es null y `total_cents` NO es un importe.
if (!data.anadidos.monedas_mezcladas) {
  console.log(data.anadidos.total, data.anadidos.moneda)          // «24,00 €», «EUR»
}
data.anadidos.asientos_sin_precio                                  // asientos que no suman
data.asientos[0]?.precio_cents                                     // null = sin precio propio

// Qué tiene activado cada cliente, con NOMBRE (antes solo había un recuento):
for (const fila of (await central.overview()).data.cartera) {
  fila.activaciones.map((a) => `${a.kind}:${a.slug} — ${a.name}`)
}

// Si un módulo se reprecio después de activarse:
const { items } = (await central.activaciones.list('talleres-ana')).data
items.filter((i) => i.cambio_de_precio)  // precio_inicial_cents vs price_cents

// Tu tramo por volumen; el descuento YA está aplicado en los wholesale_price_*:
const { wholesale_tier } = (await central.catalogo.get()).data.disponibles
wholesale_tier.next?.seats_missing     // asientos que faltan para el siguiente
```

⚠️ En la 0.33.0 `currency` del `PUT /desarrollador/catalogo` es un enum cerrado
(`CatalogoCurrency`), no cualquier código de tres letras, y `compliance-es` /
`compliance-fr` salen de `en_lugar_de` y `componentes_pimia`.

Los tipos salen de `spec/pimia-central-v1.json` (`@pimia/sdk/central-api`).

## Más

Documentación completa, modelo mental (un tenant = una base URL = un token),
tabla de errores tipados y el contrato OpenAPI, en el monorepo:
[Pimia-AI/pimia-sdks](https://github.com/Pimia-AI/pimia-sdks).

### Acciones pendientes (0.30.0 preparada)

```ts
import { isOwnerConfirmationRequired } from '@pimia/sdk'
import type { ApiSuccess } from '@pimia/sdk'

const result = await client.put<ApiSuccess<'users.update'>>('/users/42', { role: 'admin' })
if (isOwnerConfirmationRequired(result)) {
  mostrarPendiente(result.message) // data.id es la solicitud, no el usuario.
} else {
  mostrarUsuarioActualizado(result)
}

const cambio = await central.tenants.production('acme', { plan: 'pro' })
if (cambio.estado === 'primer_periodo_pendiente') {
  compartirConCliente(cambio.checkoutUrl) // Todavía no está en producción.
}
```

`central.tenants.attachVertical(slug, {vertical, plan?})` devuelve la misma unión.
`central.tenants.transferOwnership()` devuelve la confirmación pendiente del dueño,
no el tenant traspasado. `owner_confirmation_mail_failed` (503) se conserva en
`PimiaApiError.code`; no se reintenta automáticamente. El SDK no abre enlaces
ni ejecuta la confirmación. La cartera/ficha obtiene `CobroDeInstancia` de
`central.overview().data.cartera[].cobro`; puede ser null, igual que su enlace.

Cambios incompatibles y versión propuesta: [Cómo migrar](../CHANGELOG.md#cómo-migrar).

### Contratos: modos, modelos y vista previa (0.34.0)

Un contrato tiene **modo**, y el modo manda sobre el resto de la ficha:

```ts
// Cuotas: la recurrente nace al activar.
await client.contracts.create({
  title: 'Mantenimiento', customer_id: 5, starts_at: '2026-10-01',
  billing_mode: 'INSTALLMENTS', amount: 12000, billing_every: 'MONTHLY',
})

// Hitos: total opcional, guía ordenada, proyecto y clausulado elegido.
await client.contracts.create({
  title: 'Reforma', customer_id: 5, starts_at: '2026-10-01',
  billing_mode: 'MILESTONES', total_amount: 450000, project_id: 11,
  contract_model_version_id: 9,
  milestones: [
    { description: 'Fase 1', amount: 150000, planned_date: '2026-11-01', position: 1 },
    { description: 'Fase 2', amount: 300000, planned_date: null, position: 2 },
  ],
})
```

`ONE_OFF` lleva `total_amount` opcional y `NONE` no lleva nada económico:
es un documento que se firma. `customer_id` sigue siendo obligatorio en los
cuatro, y un campo ajeno al modo es un **422**, no un dato que se ignore. Un
alta sin `billing_mode` se resuelve al persistido o a `INSTALLMENTS`, así que
los contratos anteriores no cambian.

⛔ **Solo `INSTALLMENTS` factura.** En los otros tres, `activate` pasa a ACTIVE
sin crear recurrente ni factura, y `recurringInvoiceId` ahí es un 422. Los
hitos son **guía**: no emiten nada. La factura de un hito se crea a mano y se
ve bajo el contrato:

```ts
await client.invoices.create({ customer_id: 5, invoice_date: '2026-11-02', due_date: '2026-11-30', contract_id: 7, items: [...] })
```

**El clausulado propio de la empresa.** Es un formato de datos —bloques y,
dentro, texto o marcadores—, nunca HTML ni plantilla:

```ts
const { data: diccionario, meta } = await client.contracts.models.variables({ billing_mode: 'MILESTONES' })
// meta.block_types, meta.inline_types y meta.limits vienen del servidor: no los claves.

const { data: modelo } = await client.contracts.models.create({
  name: 'Mantenimiento',
  content: [
    { type: 'heading', level: 2, text: [{ type: 'text', value: 'Objeto', bold: true }] },
    { type: 'paragraph', text: [{ type: 'text', value: 'Entre ' }, { type: 'variable', key: 'customer.name' }] },
    { type: 'table', variable: 'contract.milestones' },
    { type: 'signature' }, // dónde firma el cliente: uno, ni cero ni dos
  ],
  draft_revision: 0,
})
await client.contracts.models.publish(modelo.id) // versión INMUTABLE
```

Guardar contenido exige la `draft_revision` que leíste: si otra edición guardó
mientras tanto, es un **409** y hay que recargar y reaplicar. Publicar la v2 no
toca la v1 ni los contratos que la eligieron; `archive` retira de las
selecciones nuevas y no borra historial. Los `modes` de cada marcador dicen con
qué modos es compatible, y `guarded` que además hay que **poder ver** el dato.
El catálogo tiene **abilities propias**: poder enviar un contrato no concede
redactar modelos.

**Revisar antes de firmar**, que desde el #934 es el recorrido:

```ts
const vista = await client.contracts.documentPreview(7, { name: 'Ana', email: 'ana@example.test' })
const pdf = await client.contracts.documentPreviewDownload(7, vista.data.reference) // Blob
await client.contracts.signature.send(7, {
  name: 'Ana', email: 'ana@example.test', document_version_id: vista.data.reference,
})
```

La preview **no envía**: no crea envelope, no manda correos y no consume
intento de firma. Los bytes se sirven del archivo y no se regeneran nunca —un
PDF horneado de nuevo sería otro documento—. `source_document_sha256` es
evidencia, **no autorización**: lo que se manda es la `reference`, y el
servidor lo vuelve a comprobar bajo bloqueo.

⛔ Si falta un dato o la revisión dejó de ser vigente, el 422 trae **todos** los
motivos y no se reintenta solo:

```ts
try { await client.contracts.documentPreview(7) }
catch (e) { const motivos = contractDocumentBlockers(e); if (motivos) mostrarBloqueo(motivos) }
```

`implicit_preview: true` marca la revisión que preparó el propio envío de un
contrato sin modelo: **no acredita que nadie haya visto el papel**.

### Firma del cliente en contratos (0.32.0)

```ts
const sent = await client.contracts.signature.send(7, {
  name: 'Ana', email: 'ana@example.test', send_email: true,
}, { idempotencyKey: 'contrato-7-firma-1' })
// sent.data es ContractResource; sent.signingUrl es una capacidad para firmar.
const { data } = await client.contracts.signature.status(7)
const accepted = await client.contracts.signature.remind(7) // 202: { success: boolean }
await client.contracts.signature.cancel(7) // cancela la firma, no el contrato
```

`send` acepta además `subject` y `body`; su cuerpo es el tipo exportado
`ContractSignatureRequest`. Las cuatro respuestas derivan del OpenAPI. `status`
exige `contracts:read`; las otras acciones, `contracts:write`. Los métodos
aceptan las opciones habituales de cabeceras/señal; los POST también admiten
`idempotencyKey`.

`signingUrl` solo vuelve en `send`: no lo registres en logs ni lo expongas en
listados. El resto consulta o modifica el estado del núcleo sin devolver esa
capacidad. `data.signature` contiene estado, versión, fechas y hashes; fechas
y hashes pueden ser null. El spec tipa `status` como string, sin enum.
Completar la firma no activa el contrato y volver del navegador no acredita
que esté firmado. El 202 del recordatorio acepta el correo, no su entrega;
para personalizar su `subject`/`body`, usa el POST genérico a la misma ruta.
