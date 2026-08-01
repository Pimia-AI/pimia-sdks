# @pimia/sdk

Cliente TypeScript oficial de la API de Pimia para **apps de partner**: OAuth
con PKCE, **rotación del refresh token** persistida, reintentos de rate limit y
tipos generados del OpenAPI. Licencia MIT.

Requisitos: Node ≥ 20 (o cualquier runtime con `fetch` y WebCrypto global).

## Instalación

```bash
npm install @pimia/sdk
```

> **Pendiente del primer publish en npm.** El repositorio ya es **público**,
> así que mientras tanto no hace falta invitación: clona
> `Pimia-AI/pimia-sdks`, compila este directorio (`npm ci && npm run build`) e
> instálalo por ruta (`npm install /ruta/a/pimia-sdks/typescript`) o como
> tarball (`npm pack`). Ojo, `npm install git+https://…` **no** vale: npm
> instalaría la raíz del monorepo, no `typescript/`. El detalle está en el
> [README del monorepo](https://github.com/Pimia-AI/pimia-sdks#instalación).

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

## Más

Documentación completa, modelo mental (un tenant = una base URL = un token),
tabla de errores tipados y el contrato OpenAPI, en el monorepo:
[Pimia-AI/pimia-sdks](https://github.com/Pimia-AI/pimia-sdks).
