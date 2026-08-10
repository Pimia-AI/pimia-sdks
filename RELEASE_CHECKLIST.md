# Checklist de release

**v0.1.0 publicada el 2026-08-01**: `@pimia/sdk` y `@pimia/design-tokens` en
npm (con provenance SLSA) y `pimia/pimia-php` en Packagist. Verificada con
instalación limpia de los tres en proyectos vacíos.

**v0.2.0 — 2026-08-09**: contrato con el scope de cada operación, idempotencia
de primera clase (`idempotencyKey` + `requestWithMeta`) y siete operaciones que
el spec no reflejaba. Todo aditivo. `@pimia/design-tokens` va a 0.2.0 **sin
cambios**: el versionado es en bloque y el tag arrastra a los tres paquetes.

**v0.3.0 publicada el 2026-08-10**: verificador de webhooks y
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

**v0.4.0 — 2026-08-10**: `external_ref`, la referencia externa consultable, en
los dos SDKs — campo en el alta de clientes/presupuestos/facturas y en el
cuerpo del convert, filtro en los tres listados, la clave en los cinco eventos
de recurso de los webhooks, y el 422 `external_ref_already_used` tipado con
`existingId` (el find-or-create sin mapeo local). Todo aditivo.

Sale el mismo día que la 0.3.0 porque el contrato del core llegó después: la
0.3.0 se publicó sin nada de esto. Dos avisos de esta preparación, por si se
repiten:

- **`scripts/sync-spec.sh` copia del working tree del checkout del core**, no
  de `origin/main`. Si ese checkout está en otra rama —lo normal con varios
  worktrees a la vez—, se sincroniza un spec viejo sin que nada avise. Sacarlo
  a mano con `git show origin/main:docs/openapi/pimia-api-v1.json` y comparar.
- **`origin/main` del core se mueve durante la sesión.** Comprobar el estado de
  los PRs de los que dependa la release justo antes de tagear, no al empezar.

Verificada antes de tagear: TypeScript 48/48 y build estricto; PHP 57/57 en el
contenedor de Hetzner dev, desde un **clone de la rama** (el código llega a los
servidores por git, nunca por `scp` ni `docker cp`).

**v0.5.0 — 2026-08-10**: la segunda oleada del primer integrador real
(recomendación (d) del informe de dirección) — `externalRef` en
`convertToInvoice` (TS como opción, PHP como tercer parámetro: es lo que hace
que `invoice.created`/`invoice.paid` no lleguen con la referencia nula) y
`ReadOptions` (`headers`, `signal`) en las lecturas TS. Todo aditivo. El PR
del TS (#17) llegó sin la paridad PHP; se añadió en el PR de release (#18) —
para la próxima: **un hueco tapado en un SDK se tapa en los dos o se anota la
asimetría en el changelog**, que es lo que ahora hace la entrada de 0.5.0 con
`ReadOptions` (en PHP no existe: el cliente HTTP es PSR-18 inyectado y el
timeout va ahí).

Verificada antes de tagear: TS 55/55 y build estricto en local; matriz entera
de la CI en verde sobre el PR #18 (Node 20/22/24, PHP 8.2/8.3/8.4, starter,
guarda de deriva spec↔`api.ts`) — desde esta versión la CI de PR cubre lo que
antes se hacía a mano en el contenedor de Hetzner. El paso 4 del runbook (bump
del starter) se hizo tras publicar; la nota de abajo sobre `^0.1.0` quedó
vieja: la 0.4.0 ya lo subió.

Este fichero queda como **runbook del próximo release** y como registro de lo
que salió mal la primera vez.

> ## ✅ El bloqueo del espejo PHP está resuelto (2026-08-10)
>
> El job del espejo **no había funcionado nunca**, por dos causas distintas, y
> el PAT ya no interviene.
>
> Lo que decía este fichero —«`SPLIT_PUSH_TOKEN` caducó»— **era un diagnóstico
> equivocado**. La pista está en el texto del error: `remote: Permission to
> Pimia-AI/pimia-php.git denied to galeote` con `403`. Ese mensaje significa que
> GitHub **autenticó** el token como `galeote` y luego le **denegó la
> autorización**; un token caducado no llega a autenticar y falla antes con otro
> error. Y `galeote` tiene admin sobre el espejo, así que la cuenta nunca fue el
> problema: lo era el token, por selección de repos, por permiso, o por estar
> pendiente de aprobación de la organización.
>
> **Ahora se empuja con una deploy key** (`SPLIT_PUSH_KEY`), que no caduca, solo
> abre ese repo y no depende de ninguna cuenta personal. Probada de punta a
> punta antes de cambiar el workflow: split real, push a una rama de usar y
> tirar en el espejo y borrado de esa rama.
>
> `SPLIT_PUSH_TOKEN` **ya no existe** (retirado el 2026-08-10, tras pasar en
> verde el release de la v0.4.0 con el espejo incluido). Los únicos secretos que
> usa el workflow son `NPM_TOKEN` y `SPLIT_PUSH_KEY`. Si en algún sitio lees que
> el PAT es un fallback, es texto viejo: no hay PAT que reactivar.
>
> Comprobación de que el espejo quedó bien tras publicar:
> `curl -s https://repo.packagist.org/p2/pimia/pimia-php.json | grep -o '"version":"v0.4.0"'`

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

## Cómo leer un 403 del espejo (v0.2.0)

El mensaje dice **a quién** se le denegó, y eso es el diagnóstico:

- `denied to github-actions[bot]` → el push está usando las credenciales del
  checkout, no las tuyas. Es el tropiezo 3 de abajo: falta
  `persist-credentials: false`.
- `denied to <un usuario>` → el token **sí autenticó** y se le negó el permiso.
  No es caducidad: un token caducado no llega a autenticar. Mira la selección de
  repos del token, sus permisos, y si la org tiene pendiente de aprobar el PAT.
- Fallo de autenticación (sin nombre de nadie) → ahí sí, token muerto o mal
  copiado.

Perder esto de vista costó dar por caducado un PAT que en realidad nunca tuvo
permiso, y con ello un release entero.

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
| `SPLIT_PUSH_KEY` | Clave **privada** de una deploy key con escritura sobre `Pimia-AI/pimia-php` — el `GITHUB_TOKEN` por defecto solo alcanza a ESTE repo | `ssh-keygen`; la pública se da de alta en el espejo → Settings → Deploy keys (*Allow write access*) |

**`NPM_TOKEN` caduca; `SPLIT_PUSH_KEY` no.** Cuando el de npm caduque, el
release falla con un 401 o un 403 que no dice «tu token expiró» — mirar aquí
primero.

Rehacer la deploy key, si alguna vez hace falta:

```bash
ssh-keygen -t ed25519 -f /tmp/split_php -N '' -C 'split-php@pimia-sdks (deploy key, GitHub Actions)'
gh api -X POST repos/Pimia-AI/pimia-php/keys \
  -f title='split-php desde pimia-sdks (Actions)' \
  -f key="$(cat /tmp/split_php.pub)" -F read_only=false
gh secret set SPLIT_PUSH_KEY --repo Pimia-AI/pimia-sdks < /tmp/split_php
rm -f /tmp/split_php /tmp/split_php.pub
```

Y para probarla **sin tagear** —que es como se validó esta—, un split real
contra una rama de usar y tirar:

```bash
export GIT_SSH_COMMAND='ssh -i /tmp/split_php -o IdentitiesOnly=yes'
git subtree split --prefix=php -b split/php-smoke
git push git@github.com:Pimia-AI/pimia-php.git split/php-smoke:refs/heads/smoke-test
git push git@github.com:Pimia-AI/pimia-php.git :refs/heads/smoke-test   # limpiar
git branch -D split/php-smoke
```

## Split manual del espejo PHP (rescate, si el job del espejo falla)

Empuja con **tu** clave SSH, no con la deploy key del workflow: es un rescate a
mano, no el camino normal. Ajusta `VERSION` a la que estés publicando.

```bash
VERSION=v0.4.0
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
