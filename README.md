# SDKs de Pimia

Clientes oficiales de la API de Pimia para **apps de partner**: TypeScript
(`@pimia/sdk`) y PHP (`pimia/pimia-php`). Licencia MIT.

Tu app vive en tu infraestructura y habla con el core por REST. Los SDKs
resuelven la parte que se hace mal cuando se escribe a mano: la ceremonia
OAuth, la **rotación del refresh token** y los reintentos.

| Paquete | Directorio | Requisitos |
|---------|-----------|------------|
| `@pimia/sdk` | [`typescript/`](typescript) | Node ≥ 20 (o cualquier runtime con `fetch` y WebCrypto global) |
| `pimia/pimia-php` | [`php/`](php) | PHP ≥ 8.2 + un cliente HTTP PSR-18 |
| `@pimia/design-tokens` | [`design-tokens/`](design-tokens) | Opcional: tokens + CSS vars + preset Tailwind del sistema de diseño (el white-label es poder no usarlo) |

**¿Empiezas de cero?** [`examples/starter-vertical`](examples/starter-vertical)
es la **app vertical de referencia** (Next.js): OAuth server-side resuelto
(login, sesión, almacén de tokens con rotación), facturas y clientes con
detalle, el ciclo completo de presupuestos como flujo vertical, y **dos pieles
conmutables** — marca de partner inventada o el sistema de diseño de Pimia vía
`@pimia/design-tokens` — que demuestran el white-label. Clónala y cámbiale la
marca.

CI verifica Node 20/22/24 y PHP 8.2/8.3/8.4 en cada push. Node 18 queda fuera:
no expone `globalThis.crypto` (llegó en 19) y está EOL desde abril de 2025.

## Instalación

Cuando los paquetes estén publicados (**pendiente del primer publish** — el
estado está en [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md)):

```bash
npm install @pimia/sdk            # pendiente del primer publish
composer require pimia/pimia-php  # pendiente del alta en Packagist
```

`pimia/pimia-php` se sirve desde
[`Pimia-AI/pimia-php`](https://github.com/Pimia-AI/pimia-php), un **espejo de
solo lectura** de `php/` que el workflow de release regenera en cada tag:
Composer exige el `composer.json` en la raíz del repositorio y aquí el paquete
vive en un subdirectorio. El código y las incidencias, en este monorepo.

### Camino vigente: desde este repo (público, sin invitación)

Los dos paquetes viven en subdirectorios de un monorepo, y ni npm ni Composer
saben instalar un subdirectorio desde una URL git — así que la ruta es clonar
y consumir por ruta local.

**TypeScript** — `npm install git+ssh://…` **no funciona** aquí (npm
instalaría la raíz del monorepo, no `typescript/`). Clona, compila e instala
por ruta o tarball:

```bash
git clone git@github.com:Pimia-AI/pimia-sdks.git
cd pimia-sdks/typescript && npm ci && npm run build

# En tu app — opción A: dependencia por ruta (deja "file:" en tu package.json)
npm install /ruta/a/pimia-sdks/typescript

# Opción B: tarball empaquetado (idéntico a lo que subiría a npm)
cd /ruta/a/pimia-sdks/typescript && npm pack
npm install /ruta/a/pimia-sdks/typescript/pimia-sdk-0.1.0.tgz
```

(Con pnpm sí hay instalación git directa de subdirectorios:
`pnpm add "github:Pimia-AI/pimia-sdks#path:/typescript"`.)

**PHP** — un repositorio `vcs` apuntando a este monorepo **no funciona**:
Composer exige el `composer.json` en la raíz del repo y el paquete vive en
`php/`. Usa un repositorio `path` sobre el clon:

```jsonc
// composer.json de tu app
{
  "repositories": [
    { "type": "path", "url": "../pimia-sdks/php" }
  ]
}
```

```bash
git clone git@github.com:Pimia-AI/pimia-sdks.git
composer require "pimia/pimia-php:@dev"
```

(El repositorio `vcs` clásico valdrá cuando exista el repo espejo
`Pimia-AI/pimia-php` del split de `php/` — es el mismo prerequisito del alta
en Packagist; ver `RELEASE_CHECKLIST.md`.)

## ⚠️ Lo único que tienes que leer antes de escribir código

**El refresh token de Pimia rota.** Cada refresco devuelve uno nuevo y mata el
anterior, y **reusar uno ya rotado se interpreta como robo: revoca el grant
entero en cascada**. Tus tokens mueren y el usuario tiene que volver a
autorizarte.

Consecuencias prácticas, y las dos las cubre el SDK si lo usas como está
pensado:

1. **Persiste el conjunto de tokens tras cada refresco**, no solo el access
   token. Por eso el cliente exige un `TokenStore` en lugar de aceptar un
   string: implementa el store sobre tu BD.
2. **No refresques dos veces en paralelo con el mismo token.** El cliente
   serializa el refresco dentro del proceso; si corres varios procesos, usa un
   store compartido y un lock por usuario.

## Modelo mental

- **Un tenant = una base URL = un token.** `https://acme.pimia.es` es un
  servidor de autorización y una API; un token de ahí no vale en otro tenant
  (modelo un-token-por-tienda). Registra tu client en cada tenant.
- **Pide el scope mínimo.** Los scopes son por dominio y con acción
  (`invoices:read`, `invoices:write`…). El usuario ve cada permiso en la
  pantalla de consentimiento, con las escrituras marcadas.
- **Las reglas de negocio son del servidor.** Una factura emitida no se borra
  (se rectifica), la cadena VeriFactu es inmutable, y los FormRequests validan
  igual vengas del panel o de tu app. El SDK no las puede saltar; nada puede.

## TypeScript en 20 líneas

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

## PHP en 20 líneas

```php
use GuzzleHttp\Client;
use GuzzleHttp\Psr7\HttpFactory;
use Pimia\{Config, PimiaClient, Scopes};
use Pimia\Http\PsrTransport;
use Pimia\OAuth\{InMemoryTokenStore, OAuthClient, PkceChallenge};

$config = new Config(
    baseUrl: 'https://acme.pimia.es',
    clientId: getenv('PIMIA_CLIENT_ID'),
    clientSecret: getenv('PIMIA_CLIENT_SECRET') ?: null,
    redirectUri: 'https://miapp.example/callback',
);

$factory = new HttpFactory();
$transport = new PsrTransport(new Client(), $factory, $factory);

// 1. Autorización
$pkce = PkceChallenge::create();          // guarda $pkce->verifier en sesión
$oauth = new OAuthClient($config, $transport);
$url = $oauth->authorizeUrl([Scopes::INVOICES_READ], PkceChallenge::state(), $pkce);

// 2. Callback: canje + persistencia
$tokens = new InMemoryTokenStore();       // en producción: tu BD
$tokens->save($oauth->exchangeCode($code, PkceChallenge::fromVerifier($verifierDeSesion)));

// 3. Uso
$pimia = new PimiaClient($config, $transport, $tokens);
$invoices = $pimia->invoices->list(['page' => 1]);
```

## Errores que merece la pena distinguir

| Situación | TypeScript | PHP |
|-----------|-----------|-----|
| Token muerto o app revocada por el usuario | `UnauthorizedError` | `UnauthorizedException` |
| Falta un scope (con el scope exacto dentro) | `MissingScopeError` | `MissingScopeException` |
| Validación de negocio, errores por campo | `ValidationError` | `ValidationException` |
| Rate limit, con `retryAfter` | `RateLimitError` | `RateLimitException` |
| Fallo del flujo OAuth | `OAuthError` | `OAuthException` |

Los reintentos de 429 y el refresco tras un 401 los hace el cliente: **si ves
`UnauthorizedError` ya se intentó refrescar y falló** → vuelve a pedir
autorización al usuario. Es el caso normal cuando el usuario retira el acceso
desde Ajustes → Apps conectadas; la causa original (p. ej. `invalid_grant` del
token endpoint) queda en `error.cause` / `$e->getPrevious()` para diagnosticar.

## El contrato

[`spec/pimia-api-v1.json`](spec/pimia-api-v1.json) es el OpenAPI 3.1 de la
superficie pública (facturación, presupuestos, clientes, gastos, pagos,
artículos, banca, CRM, agenda, informes y catálogos). Es una copia del
artefacto que genera el core; para refrescarlo y regenerar los tipos:

```bash
./scripts/sync-spec.sh /ruta/al/checkout/de/factSaas
```

Fuera del contrato quedan la administración (usuarios, roles, correo, tokens),
la configuración y los endpoints internos: responden, pero pueden cambiar sin
aviso.

## Desarrollo

```bash
# TypeScript
cd typescript && npm install && npm run generate:types && npm run build && npm test

# PHP
cd php && composer install && vendor/bin/phpunit
```

## Estado

**v0.1.0, sin publicar.** El núcleo OAuth, el cliente y los tipos están
completos y con tests; los helpers de dominio cubren facturas, clientes y
presupuestos — para el resto, `client.get('/loquesea')` con los tipos del
spec. La publicación está **a un tag de distancia**: el workflow de release
(`.github/workflows/release.yml`) publica `@pimia/sdk` en npm con cada tag
`v*`, y los pasos humanos que faltan (token, alta en Packagist, visibilidad
del repo) están en [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md). Pendiente
de código: ampliar helpers, DTOs de PHP generados del spec y webhooks cuando
existan.

**Validado contra un tenant real** (dev de Pimia, 2026-07-29) con
[`examples/e2e-dev`](examples/e2e-dev): autorización de un usuario de verdad,
canje, `invoices:read`/`customers:read` en 200, `expenses` en 403 tipado,
refresco con rotación persistida y revocación. Ese ejercicio destapó un fallo
de contrato que ya está corregido: un refresco fallido escapaba como
`OAuthError` en vez de `UnauthorizedError`.
