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

```bash
npm install @pimia/sdk
```

```bash
composer require pimia/pimia-php
```

Los dos publicados en **v0.1.0** (2026-08-01). El paquete de npm lleva
[provenance SLSA](https://docs.npmjs.com/generating-provenance-statements)
firmada por el workflow de release: el tarball es verificablemente este repo.

El sistema de diseño es **opcional** y va aparte —el white-label es poder no
usarlo—, así que solo si lo quieres:

```bash
npm install @pimia/design-tokens
```

`pimia/pimia-php` se sirve desde
[`Pimia-AI/pimia-php`](https://github.com/Pimia-AI/pimia-php), un **espejo de
solo lectura** de `php/` que el workflow de release regenera en cada tag:
Composer exige el `composer.json` en la raíz del repositorio y aquí el paquete
vive en un subdirectorio. El código y las incidencias, en este monorepo.

### Desde el clon (solo para desarrollar sobre los SDKs)

Ya no hace falta para consumirlos, pero si trabajas sobre el propio SDK: ni
npm ni Composer instalan un subdirectorio desde una URL git, así que la ruta
es clonar y consumir por ruta local.

```bash
git clone git@github.com:Pimia-AI/pimia-sdks.git
cd pimia-sdks/typescript && npm ci && npm run build
npm install /ruta/a/pimia-sdks/typescript   # o `npm pack` y el .tgz
```

(Con pnpm sí hay instalación git directa de subdirectorios:
`pnpm add "github:Pimia-AI/pimia-sdks#path:/typescript"`.)

En PHP, un repositorio `path` sobre el clon:

```jsonc
// composer.json de tu app
{
  "repositories": [
    { "type": "path", "url": "../pimia-sdks/php" }
  ]
}
```

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

## Tu identificador dentro de Pimia: `external_ref`

Cuelga **tu** identificador —el id del deal, del pedido, de la oportunidad— del
recurso de Pimia, y recupéralo por él. Es la alternativa a mantener una tabla
`mapeo` en tu lado, que es lo que todo integrador acaba escribiendo y lo que se
desincroniza en cuanto un proceso se cae a medias.

Acepta `external_ref` el alta de clientes, presupuestos y facturas, y también
`POST /estimates/{id}/convert-to-invoice`, para que la factura que sale de una
conversión nazca ya etiquetada. Se consulta con `?external_ref=…` en los tres
listados, vuelve en el recurso y **viaja en los webhooks**.

**El alcance es tu client OAuth**: dos integradores pueden usar la misma cadena
sin pisarse y ninguno ve la del otro. Máximo 255 caracteres; `null` desvincula.

### El patrón: find-or-create sin mapeo local

No consultes antes de crear. **Intenta crear con tu referencia**, y si ya
existía, el propio error te dice cuál es — en `existingId`. Una llamada en el
caso normal, y sin la carrera que tiene el «consulta y luego crea»:

```ts
import { DuplicateExternalRefError } from '@pimia/sdk'

async function clienteDelDeal(dealId: string, nombre: string): Promise<number> {
  try {
    const { id } = await crearCliente({ name: nombre, external_ref: `deal_${dealId}` })
    return id
  } catch (error) {
    if (error instanceof DuplicateExternalRefError) return error.existingId
    throw error
  }
}
```

```php
use Pimia\Exception\DuplicateExternalRefException;

try {
    $cliente = $pimia->customers()->create([
        'name' => $nombre,
        'external_ref' => "deal_{$dealId}",
    ]);

    return (int) $cliente['id'];
} catch (DuplicateExternalRefException $e) {
    return $e->existingId;
}
```

Por debajo es un **422** con `error: "external_ref_already_used"`, y el cuerpo
trae además el `errors` de siempre: si ya tratabas los 422 por ahí, tu código
sigue funcionando: el error nuevo hereda del de validación.

En los webhooks la clave llega **siempre** en los cinco eventos de recurso
(`customer.created`, `customer.updated`, `invoice.created`, `invoice.paid`,
`estimate.accepted`), con `null` cuando no hay referencia — nunca ausente, para
que el payload se pueda tipar. Y llega resuelta **para ti**: el emisor la
calcula endpoint por endpoint, así que nunca ves la de otro integrador.

## Errores que merece la pena distinguir

| Situación | TypeScript | PHP |
|-----------|-----------|-----|
| Token muerto o app revocada por el usuario | `UnauthorizedError` | `UnauthorizedException` |
| Falta un scope (con el scope exacto dentro) | `MissingScopeError` | `MissingScopeException` |
| Validación de negocio, errores por campo | `ValidationError` | `ValidationException` |
| `external_ref` ya usada (trae `existingId`) | `DuplicateExternalRefError` | `DuplicateExternalRefException` |
| Rate limit, con `retryAfter` | `RateLimitError` | `RateLimitException` |
| Fallo del flujo OAuth | `OAuthError` | `OAuthException` |

Los reintentos de 429 y el refresco tras un 401 los hace el cliente: **si ves
`UnauthorizedError` ya se intentó refrescar y falló** → vuelve a pedir
autorización al usuario. Es el caso normal cuando el usuario retira el acceso
desde Ajustes → Apps conectadas; la causa original (p. ej. `invalid_grant` del
token endpoint) queda en `error.cause` / `$e->getPrevious()` para diagnosticar.

## Recibir webhooks

Pimia avisa a tu app cuando pasa algo en el tenant. Los dos SDKs traen el
verificador de la firma `PIMIA-WEBHOOK-v1` y los tipos de los ocho eventos del
catálogo, así que no hay que reimplementar el HMAC ni adivinar el payload:

```ts
const hook = await verifyWebhook({ secret, headers: req.headers, body: req.body })
if (hook.known && hook.event === 'invoice.paid') cobrar(hook.payload.id)
```
```php
$hook = (new WebhookVerifier($secret))->verify($request->headers->all(), $request->getContent());
```

Tres cosas que no son obvias y cuestan un incidente cada una:

1. **Se firman los BYTES que llegan.** `express.raw()` / `$request->getContent()`,
   nunca el objeto reparseado: mismo contenido, otros bytes, firma rota.
2. **Deduplica por `delivery`.** Pimia reintenta hasta cinco veces con backoff y
   la misma entrega llega con el mismo id: procesarlo una sola vez es todo el
   exactly-once que hace falta.
3. **Responde 2xx rápido.** El trabajo pesado, a una cola; un receptor lento
   acaba desactivado tras 20 entregas muertas seguidas.

Los eventos: `approval.decided`, `invoice.received`, `app.revoked`,
`customer.created`, `customer.updated`, `invoice.created`, `estimate.accepted`
e `invoice.paid`. Detalle por lenguaje en los README de
[typescript/](typescript/README.md#recibir-webhooks) y [php/](php/README.md#recibir-webhooks).

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

**v0.2.0, publicada el 2026-08-09** en npm (`@pimia/sdk`,
`@pimia/design-tokens`) y Packagist (`pimia/pimia-php`). El núcleo OAuth, el
cliente, la idempotencia y los tipos están completos y con tests; los helpers
de dominio cubren facturas, clientes y presupuestos — para el resto,
`client.get('/loquesea')` con los tipos del spec. Cada tag `v*` dispara el
workflow de release, que publica los tres artefactos.

**v0.4.0**: `external_ref` —tu identificador colgado del recurso y consultable
por él— en el contrato, en los webhooks y con el 422 duplicado tipado, sobre el
verificador de webhooks y los tipos de los ocho eventos que trajo la 0.3.0.
Pendiente de código: ampliar helpers al resto del dominio y DTOs de PHP
generados del spec.

**Validado contra un tenant real** (dev de Pimia, 2026-07-29) con
[`examples/e2e-dev`](examples/e2e-dev): autorización de un usuario de verdad,
canje, `invoices:read`/`customers:read` en 200, `expenses` en 403 tipado,
refresco con rotación persistida y revocación. Ese ejercicio destapó un fallo
de contrato que ya está corregido: un refresco fallido escapaba como
`OAuthError` en vez de `UnauthorizedError`.
