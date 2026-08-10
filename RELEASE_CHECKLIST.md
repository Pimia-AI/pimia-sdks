# Checklist de release

**v0.1.0 publicada el 2026-08-01**: `@pimia/sdk` y `@pimia/design-tokens` en
npm (con provenance SLSA) y `pimia/pimia-php` en Packagist. Verificada con
instalación limpia de los tres en proyectos vacíos.

**v0.2.0 — 2026-08-09**: contrato con el scope de cada operación, idempotencia
de primera clase (`idempotencyKey` + `requestWithMeta`) y siete operaciones que
el spec no reflejaba. Todo aditivo. `@pimia/design-tokens` va a 0.2.0 **sin
cambios**: el versionado es en bloque y el tag arrastra a los tres paquetes.

**v0.3.0 — 2026-08-10 (preparada, SIN publicar)**: verificador de webhooks y
tipos de los ocho eventos del catálogo en los dos SDKs,
`estimates.convertToInvoice`, helpers que devuelven tipos del OpenAPI, y el
spec regenerado con la oleada 1 del plan de integradores. Es la primera
versión con un **cambio incompatible**: los cuerpos de escritura de
`invoices`/`customers`/`estimates` pasan de `unknown` a los tipos del spec.

Verificada antes de tagear: TypeScript 45/45 y build estricto; PHP 54/54 en
**8.2, 8.3 y 8.4** —la matriz entera de la CI, en Hetzner dev, con los ficheros
comprobados por `sha256sum` contra los locales para no estar probando otra
cosa—; starter compilado con las dos pieles; y la guarda de deriva
spec↔`api.ts` en verde. Nota para la próxima: las imágenes `php:X-cli` vienen
sin `unzip` y `composer install` muere con «The zip extension and unzip/7z
commands are both missing» — hay que instalarlo antes.

Este fichero queda como **runbook del próximo release** y como registro de lo
que salió mal la primera vez.

> ## 🚨 BLOQUEO ACTIVO ANTES DE PUBLICAR LA 0.3.0
>
> **`SPLIT_PUSH_TOKEN` está caducado.** El job del espejo PHP falla con `403` y
> la v0.2.0 hubo que rescatarla empujando el subtree a mano (receta más abajo).
> El PAT solo lo puede regenerar Pablo:
> github.com/settings/personal-access-tokens → fine-grained, *Contents: read
> and write* sobre `Pimia-AI/pimia-php`.
>
> **No tagees hasta que el secret esté renovado.** Si se tagea con el token
> muerto, npm publica y el espejo no, y entonces ya no se puede rehacer el tag
> (ver el aviso de abajo): quedaría Packagist una versión por detrás de npm
> hasta el siguiente release.
>
> Comprobación rápida de que el espejo quedó bien tras publicar:
> `curl -s https://repo.packagist.org/p2/pimia/pimia-php.json | grep -o '"version":"v0.3.0"'`

## Runbook del próximo release

1. Subir la versión en los tres manifiestos —`typescript/package.json`,
   `design-tokens/package.json` y el `CHANGELOG.md`—; el workflow **aborta**
   si el tag y el `package.json` no coinciden.
2. Con `main` verde: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. El workflow publica los dos paquetes de npm y regenera el espejo PHP con
   su tag. Packagist lo recoge solo, si la GitHub App está puesta.
4. **Después de publicar**, subir las dependencias `@pimia/*` de
   `examples/starter-vertical/package.json` a la versión recién publicada, en
   un commit aparte. Van una detrás a propósito: el job `starter` de la CI
   instala **desde npm** antes de compilar, así que declarar una versión que
   todavía no existe pondría la CI en rojo justo en la PR del release. Hoy
   siguen en `^0.1.0` —se olvidó en la 0.2.0— y eso significa que un partner
   que copie el starter se lleva un SDK que no compila con su código.

**⚠️ Un tag solo se puede mover mientras no se haya publicado NADA.** En
cuanto npm acepte el primer paquete, un fallo posterior se arregla subiendo
de versión — nunca reescribiendo el tag. Comprobación:
`curl -o /dev/null -w '%{http_code}' https://registry.npmjs.org/@pimia%2Fsdk`.

## Los tres tropiezos de la v0.1.0, para no repetirlos

1. **El scope `@pimia` no aparece** en el desplegable del token de npm hasta
   que la **organización existe**. Crearla es el paso previo, no simultáneo.
2. **El token de npm necesita «Bypass two-factor authentication (2FA)»**
   marcado. Sin esa casilla el publish muere con
   `403 … granular access token with bypass 2fa enabled is required`: un
   runner no puede teclear un código de un solo uso. Lo que acota el riesgo
   es que el token esté limitado al scope y caduque.
3. **El job del espejo necesita `persist-credentials: false`** en el
   checkout. Sin eso el push sale como `github-actions[bot]` y da 403 aunque
   el PAT sea correcto: checkout deja el `GITHUB_TOKEN` como cabecera
   `http.extraheader` y esa cabecera pisa el token de la URL del remoto.
   El mensaje de error señala al bot y no al secret, así que invita a
   sospechar del PAT, que era válido.

## Secrets del repo

| Secret | Qué es | Dónde se crea |
|---|---|---|
| `NPM_TOKEN` | Granular token de npm, *read and write* sobre el scope `@pimia`, con bypass 2FA | npmjs.com → Access Tokens |
| `SPLIT_PUSH_TOKEN` | PAT fine-grained con *Contents: read and write* sobre `Pimia-AI/pimia-php` — el `GITHUB_TOKEN` por defecto solo alcanza a ESTE repo | github.com/settings/personal-access-tokens |

Los dos caducan. El día que lo hagan, el release falla con un 401 o un 403 que
no dice «tu token expiró» — mirar aquí primero.

## Split manual del espejo PHP (si el job falla o no hay `SPLIT_PUSH_TOKEN`)

```bash
VERSION=v0.3.0
git branch -D split/php 2>/dev/null
git subtree split --prefix=php -b split/php
git push --force git@github.com:Pimia-AI/pimia-php.git split/php:main
git push --force git@github.com:Pimia-AI/pimia-php.git split/php:refs/tags/$VERSION
```

## Conectar Packagist con GitHub (si algún día hay que rehacerlo)

Conceder acceso a la organización desde GitHub **no basta**: la cuenta de
Packagist tiene que estar conectada a GitHub por su lado (perfil →
`Settings`), o `https://packagist.org/trigger-github-sync/` responde
«You must connect your user account to github to sync packages» sin más
pistas. Con las dos mitades hechas, la sincronización crea el hook sola.

Alternativa sin OAuth: webhook manual en el espejo con payload
`https://packagist.org/api/github?username=USUARIO`, `application/json`,
solo evento *push*, y de secreto el **Safe API Token** (no el Main: el safe
solo alcanza APIs seguras como actualizar un paquete).
