# Checklist de release — v0.1.0

Lo que queda para publicar `@pimia/sdk` (npm) y `pimia/pimia-php` (Packagist).
Todo lo automatizable ya está hecho; cada paso de abajo es un click humano 👤
y está en orden. Los marcados **⚠️ IRREVERSIBLE** no tienen vuelta atrás.

## Ya hecho (en el repo)

- [x] Metadata de publicación completa en `typescript/package.json`
      (repository/homepage/bugs/author/publishConfig) y `php/composer.json`
      (authors/homepage/support).
- [x] `npm publish --dry-run` verificado: el tarball lleva `dist/`, README y
      LICENSE — ni src ni tests.
- [x] `CHANGELOG.md` con la entrada 0.1.0.
- [x] Workflow `.github/workflows/release.yml`: con un tag `v*` corre
      build+tests (TS y PHP) y publica `@pimia/sdk` en npm. Sin tag o sin el
      secret `NPM_TOKEN`, no puede publicar.
- [x] Instalación documentada en los README: camino futuro (npm/Packagist,
      marcado «pendiente de publicación») y camino vigente por repo privado.

## Pasos 👤 en orden

### 0. Decidir la visibilidad del repo

- [ ] Tras el dictamen AGPL (el import auditado: 52,8 % de líneas), decidir si
      el repo se hace público. **⚠️ IRREVERSIBLE en la práctica**: aunque
      GitHub permite volver a privado, todo el histórico queda expuesto y
      clonable desde el minuto uno; forks y copias no se pueden retirar.
- Publicar en npm **no** exige repo público (el tarball es autocontenido).
  Packagist tampoco lo exige, pero un paquete de Packagist sobre repo privado
  no lo puede instalar nadie sin acceso al repo — en la práctica, Packagist
  espera repo público.

### 1. npm — scope y token

- [ ] Verificar/crear la organización `pimia` en npmjs.com (el scope
      `@pimia/*` tiene que existir y ser nuestro antes del primer publish).
- [ ] Crear un **granular access token** en npmjs.com con permiso
      *Read and write* limitado al scope `@pimia` (y expiración razonable).
- [ ] Añadirlo como secret del repo: GitHub → `Pimia-AI/pimia-sdks` →
      Settings → Secrets and variables → Actions → `NPM_TOKEN`.

### 2. Publicar @pimia/sdk (tag)

- [ ] Desde `main` con CI verde:

  ```bash
  git tag v0.1.0 && git push origin v0.1.0
  ```

  El workflow `release.yml` hace el resto (tests → `npm publish`).
  **⚠️ IRREVERSIBLE**: publicar en npm es permanente. `npm unpublish` solo
  está permitido 72 h y con condiciones; el nombre+versión `0.1.0` queda
  quemado para siempre aunque se despublique.

### 3. Packagist — pimia/pimia-php

Packagist y los repos `vcs` de Composer exigen el `composer.json` en la
**raíz** del repo; el paquete vive en `php/`, así que hace falta un repo
espejo de solo lectura (split), igual que hacen Laravel o Symfony:

- [ ] Crear el repo `Pimia-AI/pimia-php` en GitHub (público si se publica).
- [ ] Hacer el split y empujarlo, incluyendo el tag:

  ```bash
  git subtree split --prefix=php -b split/php
  git push git@github.com:Pimia-AI/pimia-php.git split/php:main
  git push git@github.com:Pimia-AI/pimia-php.git split/php:refs/tags/v0.1.0
  ```

  (Para releases siguientes: repetir el split en cada tag, o automatizarlo
  con `splitsh-lite` en un workflow cuando haya cadencia.)
- [ ] Alta en <https://packagist.org/packages/submit> con la URL del repo
      espejo. **⚠️ IRREVERSIBLE en la práctica**: el nombre
      `pimia/pimia-php` queda registrado; borrar un paquete usado rompe a
      quien lo instale.
- [ ] Verificar que el auto-update queda activo (GitHub App de Packagist o
      webhook); si no, cada tag habrá que sincronizarlo a mano.

### 4. Verificación de instalación limpia

- [ ] En un proyecto vacío: `npm install @pimia/sdk` y compilar el snippet
      del README.
- [ ] En un proyecto vacío: `composer require pimia/pimia-php` y correr el
      snippet del README.
- [ ] Quitar los avisos «pendiente de publicación» de los README.

### Decisiones aplazadas (no bloquean la v0.1.0)

- [ ] ¿Se publica también `@pimia/design-tokens`? Hoy `release.yml` publica
      solo `@pimia/sdk`; si se decide que sí, darle la misma metadata de
      publicación y añadirlo al workflow.
- [ ] Cuando el repo sea público: añadir `--provenance` al `npm publish` de
      `release.yml` (con repo privado falla, por eso no está).
