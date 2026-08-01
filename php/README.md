# pimia/pimia-php

Cliente PHP oficial de la API de Pimia para **apps de partner**: OAuth con
PKCE, **rotación del refresh token** persistida, reintentos de rate limit y
excepciones tipadas. Licencia MIT.

Requisitos: PHP ≥ 8.2 + un cliente HTTP PSR-18 (cualquiera vale; Guzzle es el
sugerido).

## Instalación

```bash
composer require pimia/pimia-php
```

> **Pendiente de publicación en Packagist.** Mientras tanto, instala desde el
> monorepo privado (necesitas invitación) con un repositorio `path` — un
> repositorio `vcs` apuntando al monorepo **no funciona**, porque Composer
> exige el `composer.json` en la raíz del repo y este paquete vive en `php/`:
>
> ```jsonc
> // composer.json de tu app
> {
>   "repositories": [
>     { "type": "path", "url": "../pimia-sdks/php" }
>   ]
> }
> ```
>
> ```bash
> git clone git@github.com:Pimia-AI/pimia-sdks.git
> composer require "pimia/pimia-php:@dev"
> ```

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

## Más

Documentación completa, modelo mental (un tenant = una base URL = un token),
tabla de excepciones tipadas y el contrato OpenAPI, en el monorepo:
[Pimia-AI/pimia-sdks](https://github.com/Pimia-AI/pimia-sdks).
