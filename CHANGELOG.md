# Changelog

Historial de versiones del monorepo. Los dos SDKs (`@pimia/sdk` y
`pimia/pimia-php`) versionan juntos: un tag `vX.Y.Z` en este repo corresponde
a la misma versión en ambos paquetes.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado es [SemVer](https://semver.org/lang/es/). En 0.x la API
pública puede cambiar entre minors.

## [Sin publicar]

## [0.1.0] — 2026-08-01

Primera versión **publicada**: `@pimia/sdk` y `@pimia/design-tokens` en npm (con provenance SLSA firmada por el workflow de release) y `pimia/pimia-php` en Packagist. Validados e2e contra un tenant
real (dev de Pimia, 2026-07-29) con `examples/e2e-dev`.

### `@pimia/sdk` (TypeScript)

- Cliente `PimiaClient` con refresco automático tras 401 y reintentos de 429
  (respetando `Retry-After`).
- Flujo OAuth completo con PKCE: `buildAuthorizeUrl`, `exchangeCode`,
  refresco con **rotación del refresh token persistida** vía `TokenStore`
  (serializado dentro del proceso), y revocación.
- Errores tipados: `UnauthorizedError`, `MissingScopeError`,
  `ValidationError`, `RateLimitError`, `OAuthError` (causa original en
  `error.cause`).
- Tipos de todos los endpoints generados del OpenAPI 3.1
  (`@pimia/sdk/api`), con red de seguridad en CI contra la deriva del spec.
- Helpers de dominio para facturas, clientes y presupuestos; `client.get()`
  tipado para el resto de la superficie.
- Requiere Node ≥ 20 (usa `fetch` y WebCrypto globales).

### `pimia/pimia-php` (PHP)

- Mismo diseño que el SDK TypeScript sobre PSR-18/PSR-17: `PimiaClient`,
  `OAuthClient` con PKCE, `TokenStore` con rotación persistida, refresco
  tras 401 y reintentos de 429.
- Excepciones tipadas equivalentes (`UnauthorizedException`,
  `MissingScopeException`, `ValidationException`, `RateLimitException`,
  `OAuthException`; causa original en `getPrevious()`).
- Recursos de dominio: facturas, clientes y presupuestos.
- Requiere PHP ≥ 8.2 y cualquier cliente HTTP PSR-18.

### En el monorepo (no se publican como paquete todavía)

- `@pimia/design-tokens`: el sistema de diseño como paquete opcional
  (tokens tipados, variables CSS, preset de Tailwind).
- `examples/starter-vertical`: app vertical de referencia en Next.js con
  OAuth server-side y dos pieles conmutables (white-label demostrado).
- `spec/pimia-api-v1.json`: el contrato OpenAPI 3.1 de la superficie
  pública, sincronizado desde el core con `scripts/sync-spec.sh`.
