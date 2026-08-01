# Checklist de release — v0.1.0

Estado a 2026-08-01. Lo mecánico está hecho; lo que queda **exige la cuenta
del fundador** (npm y Packagist), así que no hay forma de automatizarlo desde
aquí. Los pasos marcados **⚠️ IRREVERSIBLE** no tienen vuelta atrás.

## Hecho

- [x] Metadata de publicación completa en `typescript/package.json`,
      `design-tokens/package.json` y `php/composer.json`.
- [x] `npm publish --dry-run` verificado: el tarball lleva `dist/`, README y
      LICENSE — ni src ni tests.
- [x] `CHANGELOG.md` con la entrada 0.1.0.
- [x] **Repositorio público** (2026-08-01, orden del fundador). Barrido previo
      del árbol y de los 15 commits del histórico: **cero credenciales** (sin
      tokens, claves privadas, `.env`, IPs internas ni rutas locales). El
      único hallazgo —el dominio del entorno de integración `taskai.work` en
      el bloque `servers` del spec— quedó **asumido explícitamente**: ya era
      público por el propio portal (developers.pimia.es sirve ese OpenAPI y el
      quickstart manda al desarrollador a ese host como sandbox, a propósito).
- [x] **Espejo `Pimia-AI/pimia-php` creado y poblado** con el subtree split de
      `php/` (público, `composer.json` en la raíz — lo que Packagist exige).
- [x] Workflow `release.yml`: con un tag `v*` corre build+tests (TS y PHP) y
      luego publica `@pimia/sdk`, publica `@pimia/design-tokens` y regenera el
      espejo PHP con su tag. Con `--provenance` (ya se puede: repo público).
- [x] READMEs sin la premisa de repo privado; el camino de instalación
      vigente documentado en los tres.

## Pasos 👤 que quedan, en orden

### 1. npm — organización y token

- [ ] Crear la organización **`pimia`** en npmjs.com (gratis para paquetes
      públicos). El scope `@pimia/*` tiene que existir y ser nuestro **antes**
      del primer publish.
- [ ] Crear un **granular access token** con permiso *Read and write*
      limitado al scope `@pimia`, con expiración razonable.
- [ ] Añadirlo como secret del repo: `Pimia-AI/pimia-sdks` → Settings →
      Secrets and variables → Actions → **`NPM_TOKEN`**.

### 2. Token para el espejo PHP

- [ ] Crear un PAT (fine-grained) con permiso de **contenido: escritura**
      sobre `Pimia-AI/pimia-php` y añadirlo como secret **`SPLIT_PUSH_TOKEN`**
      en `Pimia-AI/pimia-sdks`. Sin él, el job de split falla a propósito.
      *(Alternativa si no quieres el PAT: hacer el split a mano en cada
      release — los dos comandos están al final de este fichero.)*

### 3. Publicar (el tag lo dispara todo)

- [ ] Desde `main` con CI verde:

  ```bash
  git tag v0.1.0 && git push origin v0.1.0
  ```

  **⚠️ IRREVERSIBLE**: publicar en npm es permanente. `npm unpublish` solo se
  permite 72 h y con condiciones; el par nombre+versión `0.1.0` queda quemado
  para siempre aunque se despublique.

### 4. Packagist — alta única

- [ ] Dar de alta en <https://packagist.org/packages/submit> con la URL del
      **espejo**: `https://github.com/Pimia-AI/pimia-php`.
      **⚠️ IRREVERSIBLE en la práctica**: el nombre `pimia/pimia-php` queda
      registrado, y borrar un paquete que alguien ya instala lo rompe.
- [ ] Verificar que queda activo el auto-update (GitHub App de Packagist o
      webhook). Si no, cada tag habrá que sincronizarlo a mano.

### 5. Verificación de instalación limpia

- [ ] En un proyecto vacío: `npm install @pimia/sdk` y compilar el snippet del
      README.
- [ ] En un proyecto vacío: `composer require pimia/pimia-php` y correr el
      snippet del README.
- [ ] Quitar de los tres READMEs los avisos «pendiente del primer publish» /
      «pendiente del alta en Packagist», y anunciarlo en el changelog del
      developer de factSaas (`docs/changelog-desarrollador.md`) + republicar
      developers.pimia.es.

---

## Split manual del espejo PHP (solo si no se usa `SPLIT_PUSH_TOKEN`)

```bash
git subtree split --prefix=php -b split/php
git push --force git@github.com:Pimia-AI/pimia-php.git split/php:main
git push --force git@github.com:Pimia-AI/pimia-php.git split/php:refs/tags/v0.1.0
```
