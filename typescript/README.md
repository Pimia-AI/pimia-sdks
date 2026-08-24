# @pimia/sdk

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

## Más

Documentación completa, modelo mental (un tenant = una base URL = un token),
tabla de errores tipados y el contrato OpenAPI, en el monorepo:
[Pimia-AI/pimia-sdks](https://github.com/Pimia-AI/pimia-sdks).
