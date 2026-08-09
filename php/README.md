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

## Más

Documentación completa, modelo mental (un tenant = una base URL = un token),
tabla de excepciones tipadas y el contrato OpenAPI, en el monorepo:
[Pimia-AI/pimia-sdks](https://github.com/Pimia-AI/pimia-sdks).
