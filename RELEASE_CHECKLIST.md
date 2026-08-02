# Checklist de release — v0.1.0 ✅ PUBLICADA

**v0.1.0 publicada el 2026-08-01**: `@pimia/sdk` y `@pimia/design-tokens` en
npm (con provenance SLSA) y `pimia/pimia-php` en Packagist. Verificada con
instalación limpia de los tres en proyectos vacíos.

Este fichero queda como **runbook del próximo release** y como registro de lo
que salió mal la primera vez.

**Sin deuda abierta.** El ciclo está cerrado de punta a punta: un tag publica
en npm, regenera el espejo y Packagist lo recoge solo (hook activo sobre
`Pimia-AI/pimia-php`, evento `push`). El fix del job de split está mergeado
([#6](https://github.com/Pimia-AI/pimia-sdks/pull/6)) — hizo falta porque la
v0.1.0 del espejo se sincronizó **a mano**.

## Runbook del próximo release

1. Subir la versión en los tres manifiestos —`typescript/package.json`,
   `design-tokens/package.json` y el `CHANGELOG.md`—; el workflow **aborta**
   si el tag y el `package.json` no coinciden.
2. Con `main` verde: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. El workflow publica los dos paquetes de npm y regenera el espejo PHP con
   su tag. Packagist lo recoge solo, si la GitHub App está puesta.

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
git branch -D split/php 2>/dev/null
git subtree split --prefix=php -b split/php
git push --force git@github.com:Pimia-AI/pimia-php.git split/php:main
git push --force git@github.com:Pimia-AI/pimia-php.git split/php:refs/tags/v0.1.0
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
