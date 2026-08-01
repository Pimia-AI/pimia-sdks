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

> **Pendiente del alta en Packagist.** El código ya es **público** y no hace
> falta invitación. Dos caminos mientras tanto:
>
> **a)** repositorio `vcs` apuntando al **espejo de solo lectura**
> `Pimia-AI/pimia-php`, que sí lleva el `composer.json` en la raíz:
>
> ```jsonc
> {
>   "repositories": [
>     { "type": "vcs", "url": "https://github.com/Pimia-AI/pimia-php" }
>   ]
> }
> ```
>
> **b)** repositorio `path` sobre un clon del monorepo. Un repositorio `vcs`
> apuntando al **monorepo** no funciona: Composer exige el `composer.json` en
> la raíz del repo y aquí el paquete vive en `php/`.
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
