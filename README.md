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

CI verifica Node 20/22/24 y PHP 8.2/8.3/8.4 en cada push. Node 18 queda fuera:
no expone `globalThis.crypto` (llegó en 19) y está EOL desde abril de 2025.

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

Los reintentos de 429 y el refresco tras un 401 los hace el cliente: si ves
`UnauthorizedError` ya se intentó refrescar y falló → vuelve a pedir
autorización al usuario.

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
spec. Pendiente: publicar en npm y Packagist, ampliar helpers, DTOs de PHP
generados del spec y webhooks cuando existan.
