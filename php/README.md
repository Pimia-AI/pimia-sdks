# pimia/pimia-php

Cliente PHP oficial de la API de Pimia para **apps de partner**: OAuth con
PKCE, **rotación del refresh token** persistida, reintentos de rate limit y
excepciones tipadas. Licencia MIT.

> El código vive en el monorepo [`Pimia-AI/pimia-sdks`](https://github.com/Pimia-AI/pimia-sdks),
> directorio `php/`. [`Pimia-AI/pimia-php`](https://github.com/Pimia-AI/pimia-php)
> es un **espejo de solo lectura** que se regenera en cada release: existe
> porque Composer exige el `composer.json` en la raíz del repositorio. Las
> incidencias y los PRs, al monorepo.

Requisitos: PHP ≥ 8.2 + un cliente HTTP PSR-18 (cualquiera vale; Guzzle es el
sugerido).

## Instalación

```bash
composer require pimia/pimia-php
```

Publicado en Packagist desde v0.1.0. Requiere PHP ≥ 8.2 y un cliente HTTP
PSR-18 (Guzzle es el sugerido):

```bash
composer require guzzlehttp/guzzle
```

## Uso en 20 líneas

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

## Lo único que tienes que leer antes de escribir código

**El refresh token de Pimia rota.** Cada refresco devuelve uno nuevo y mata el
anterior; reusar uno ya rotado revoca el grant entero en cascada. Por eso el
cliente exige un `TokenStore`: persiste el conjunto de tokens tras cada
refresco y no refresques dos veces en paralelo con el mismo token. Las dos
cosas las cubre el SDK si lo usas como está pensado.

## Un servicio que reenvía el token de su usuario

Todo lo de arriba supone que **tu app posee un grant**. Hay integraciones que no
y que no deben: un servicio al que el front le manda, en cada petición, el
`Authorization` del usuario que ya entró en Pimia. Para ésas está el modo de
token prestado — sin `clientId`, sin `TokenStore` y sin ceremonia OAuth:

```php
$pimia = PimiaClient::withBorrowedToken(
    baseUrl: "https://{$tenant}.pimia.es",
    accessToken: $bearerDeQuienLlama,
    transport: $transport,
    // La empresa activa viaja en cabecera, como en todo el API. OMÍTELA cuando
    // no la sepas: `company:` vacía es una cabecera presente que no casa con
    // ninguna empresa.
    headers: $empresa === null ? [] : ['company' => (string) $empresa],
    // Atiendes una petición web: los reintentos del SDK DUERMEN, y dormir
    // dentro de la petición de un usuario es una petición colgada.
    maxRateLimitRetries: 0,
);

$empresa = $pimia->bootstrap->currentCompanyId();
$censo = $pimia->crm->assignableUsers();
```

Lo que ganas con esto es que **Pimia sigue decidiendo los permisos**: tu servicio
no puede darle a nadie más de lo que su token ya le daba, y no hay una
credencial de servicio que auditar aparte.

Tres cosas que conviene tener claras:

- **Un cliente por petición.** El token vive lo que viva la petición que lo
  trajo; una instancia compartida es una credencial compartida.
- **No se refresca.** El refresh es del dueño del grant. Cuando el token caduca,
  el 401 sube como `UnauthorizedException` y quien tiene que conseguir otro es
  quien te lo prestó. El cliente no lo intenta —y eso es deliberado: con la
  rotación de Pimia, tocar el refresh de otro revoca su grant entero.
- **`$pimia->oauth` es `null`** en este modo. No hay ceremonia que hacer, y un
  `OAuthClient` sin `clientId` compondría una URL de autorización rota que sólo
  fallaría en el navegador del usuario.

`GET /bootstrap` merece un aviso propio: **es la única respuesta del API que no
viene envuelta en `data`**. Sus claves cuelgan de la raíz, así que un
desenvolvedor de `data` escrito «para todas las llamadas» devuelve vacío sin
error — y el fallo se ve como una empresa sin resolver o como una moneda que cae
al respaldo, nunca como un fallo. `$pimia->bootstrap->currentCompanyId()` y
`->currency()` lo leen bien; `->get()` te da el cuerpo tal cual.

## Reintentar un `POST` sin duplicar

Manda una `Idempotency-Key` única por operación y Pimia ejecuta la escritura
una sola vez, por muchos reintentos que haya:

```php
$clave = bin2hex(random_bytes(16));
$client->estimates->create($presupuesto, $clave);
```

Reúsala **solo** en los reintentos de esa misma operación: la misma clave con
otro cuerpo responde `422`.

Tras un reintento el cuerpo que recibes es idéntico al de la primera llamada
—ese es justo el contrato—, así que el cuerpo solo no dice si Pimia escribió o
se limitó a repetirse. Para saberlo, `requestWithMeta()`:

```php
$r = $client->requestWithMeta('POST', '/estimates', body: $presupuesto, idempotencyKey: $clave);

if ($r->meta->idempotentReplay) {
    // ya existía: no se ha creado nada nuevo
}
```

## Recibir webhooks

`WebhookVerifier` comprueba la firma `PIMIA-WEBHOOK-v1` y te devuelve la
entrega ya parseada. No reimplementes el HMAC:

```php
use Pimia\Exception\WebhookVerificationException;
use Pimia\Webhooks\WebhookEvent;
use Pimia\Webhooks\WebhookVerifier;

$verifier = new WebhookVerifier(getenv('PIMIA_WEBHOOK_SECRET'));

try {
    // ⚠️ El cuerpo CRUDO. En Laravel, $request->getContent() — nunca
    // json_encode($request->all()): Pimia firma los bytes que envía y
    // reserializar rompe la firma sin que se vea por qué.
    $hook = $verifier->verify($request->headers->all(), $request->getContent());
} catch (WebhookVerificationException $e) {
    return response($e->reason, 400);
}

// Pimia reintenta: la misma entrega llega con el mismo id.
if ($yaProcesado($hook->delivery)) {
    return response('', 200);
}

match ($hook->event) {
    WebhookEvent::EstimateAccepted => $facturar($hook->payload['id']),
    WebhookEvent::InvoicePaid      => $cobrar($hook->payload['id']),
    default                        => null, // incluye el catálogo futuro
};

return response('', 200); // responde rápido; el trabajo pesado, a una cola
```

Los ocho eventos del catálogo están en el enum `WebhookEvent` y sus payloads
documentados como *array shapes* (PHPStan y Psalm los entienden). Un evento que
este SDK todavía no conozca **no es un error**: se verifica igual y llega con
`$hook->event === null` y el nombre crudo en `$hook->eventName`.

Detalles que ahorran un rato:

- El constructor acepta una **lista** de secretos, para rotarlo sin ventana de
  caída.
- La ventana anti-replay son 300 s; ajústala con `toleranceSeconds:`.
- `$e->reason` es legible por máquina (`signature_mismatch`,
  `timestamp_out_of_window`, `missing_headers`, `invalid_timestamp`,
  `invalid_json`) para tus métricas.
- `WebhookVerifier::sign()` firma un cuerpo como lo haría Pimia: úsalo en **tus
  tests**, no en producción.

## Más

Documentación completa, modelo mental (un tenant = una base URL = un token),
tabla de excepciones tipadas y el contrato OpenAPI, en el monorepo:
[Pimia-AI/pimia-sdks](https://github.com/Pimia-AI/pimia-sdks).
