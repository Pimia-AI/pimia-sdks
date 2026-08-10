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
