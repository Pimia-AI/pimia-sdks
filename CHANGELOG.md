# Changelog

Historial de versiones del monorepo. Los dos SDKs (`@pimia/sdk` y
`pimia/pimia-php`) versionan juntos: un tag `vX.Y.Z` en este repo corresponde
a la misma versión en ambos paquetes.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado es [SemVer](https://semver.org/lang/es/). En 0.x la API
pública puede cambiar entre minors.

## [Sin publicar]

### Añadido

- **Idempotencia de primera clase en los dos SDKs.** `Idempotency-Key` deja de
  ser una cabecera que montarte a mano:

  ```ts
  await client.estimates.create(presupuesto, { idempotencyKey: clave })
  ```
  ```php
  $client->estimates->create($presupuesto, $clave);
  ```

  Y, sobre todo, ya se puede **saber si la respuesta es un eco**. Tras un
  reintento el cuerpo es idéntico al de la primera llamada —ese es justo el
  contrato—, así que el cuerpo solo no distingue «he creado el presupuesto» de
  «ya estaba creado». `requestWithMeta` devuelve las dos cosas:

  ```ts
  const { data, meta } = await client.requestWithMeta('/estimates', {
    method: 'POST', body: presupuesto, idempotencyKey: clave,
  })
  meta.idempotentReplay // ← true si Pimia se limitó a repetirse
  ```

  `meta` trae además `status`, `requestId` y `rateLimit`. Va **por petición** y
  no como estado del cliente —al revés que `rateLimit`— a propósito: la
  idempotencia se consulta justo cuando hay reintentos, que es cuando puede
  haber varias llamadas en vuelo, y un campo compartido daría la respuesta de
  otra.

  `request()`, `post()`, `put()` y `patch()` siguen devolviendo solo el cuerpo:
  nada cambia para el código existente. En PHP, además, `request()` acepta ya
  cabeceras por petición, que antes no admitía.

- **El contrato dice ahora qué scope exige cada endpoint.**
  `spec/pimia-api-v1.json` incorpora un esquema de seguridad `oauth2` con el
  catálogo de scopes de partner (21, cada uno con su descripción) y **214
  operaciones declaran el suyo**. Antes el mapa solo existía en la prosa de la
  guía del integrador, así que había que leerse una tabla en markdown para
  saber si un token llegaba a un endpoint. Los catálogos `meta` siguen sin
  exigir scope, que es la verdad: se leen con cualquier token.

  El esquema `http` (bearer) se mantiene como seguridad global, así que nada
  cambia para quien ya lo leyera. Se añade `oauth2` porque en OpenAPI un
  requisito sobre un esquema `http` obliga a lista de scopes vacía —los scopes
  no cabían—, y porque un visor como Redoc pinta el permiso requerido en cada
  endpoint sin trabajo extra.

- `SCOPES` gana `approvalsWrite` (`approvals:write`) y su alias
  `approvalsSubmit` (`approvals:submit`), que faltaban: el catálogo del
  Authorization Server ya los emitía y la constante del SDK se había quedado
  en 19 de 21.

- **Siete operaciones nuevas** que el core ya servía y este spec no reflejaba,
  porque no se sincronizaba desde la v0.1.0: el CRUD de `custom-fields` —con
  el que se descubren por API los ids de las definiciones de campo
  personalizado, en vez de pedírselos al dueño del tenant a mano— y
  `POST /approvals` + `GET /approvals/{id}`.

  **Ninguna operación desaparece**: el refresco es aditivo y no rompe a ningún
  consumidor.

### Cambiado

- Tipos de TypeScript (`@pimia/sdk/api`) regenerados del spec nuevo.

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
