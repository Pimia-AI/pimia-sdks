# Demo e2e contra un tenant real

Ejercita el ciclo completo con `@pimia/sdk` contra un tenant de verdad: canje
del código, llamadas con y sin el scope necesario, refresco con rotación,
llamada con el token rotado y revocación. Es el guion que se usó para validar
el SDK contra el entorno de desarrollo de Pimia el 2026-07-29.

Necesita un client ya registrado en el tenant y **una autorización real de un
usuario** (hay pantalla de consentimiento: no se puede automatizar, y es lo
correcto).

> ⚠️ **Corrección fechada, 2026-08-30 — el nombre dice «dev» y los hosts de
> abajo dicen prod.** Este directorio se llama `e2e-dev` y el párrafo de arriba
> habla del «entorno de desarrollo», pero **todos los comandos de esta página
> usan `TENANT.pimia.es`, que es PRODUCCIÓN**. El dominio de desarrollo es
> `taskai.work`, como declara el propio contrato de este repo
> (`spec/pimia-api-v1.json`: `https://{tenant}.taskai.work/api/v1`).
>
> Seguirlos al pie de la letra **registra un client OAuth en producción**.
> Elige el dominio a conciencia:
>
> - desarrollo → `https://TENANT.taskai.work`
> - producción → `https://TENANT.pimia.es`
>
> Cuál de los dos se usó el 2026-07-29 ya no se puede saber: la etiqueta dice
> uno y los comandos dicen el otro. No cambia el hallazgo que salió de aquel
> ejercicio —el `invalid_grant` que escapaba como `OAuthError` en vez de
> `UnauthorizedError` es un fallo de mapeo del cliente, idéntico en las dos
> cajas—, pero sí obliga a no citar este ejemplo como prueba de que algo se
> midió en dev.

## 1. Registrar el client (una vez)

```bash
curl -s https://TENANT.pimia.es/oauth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "client_name": "SDK e2e (TypeScript)",
    "redirect_uris": ["https://TENANT.pimia.es/admin/settings/connected-apps"],
    "grant_types": ["authorization_code", "refresh_token"],
    "token_endpoint_auth_method": "client_secret_post",
    "scope": "invoices:read customers:read"
  }' > /tmp/pimia-e2e-client.json
```

La `redirect_uri` apunta a la pantalla «Apps conectadas» del propio panel a
propósito: el usuario acaba viendo la app que acaba de autorizar, y el `code`
queda a la vista en la barra de direcciones para pegarlo en el paso 3.

## 2. Generar la URL de autorización

```bash
export PIMIA_BASE_URL=https://TENANT.pimia.es
export PIMIA_CLIENT_JSON="$(cat /tmp/pimia-e2e-client.json)"
node authorize.mjs
```

Abre la URL que imprime, revisa los permisos y pulsa **Autorizar**.

## 3. Ejecutar el ciclo completo

```bash
node run.mjs '<code-del-callback>'
```

El código dura 10 minutos y un solo uso. Salida esperada: los seis pasos en
orden, con `MissingScopeError` en el dominio no concedido y `UnauthorizedError`
después de revocar.

## Nota

`run.mjs` incluye un `FileTokenStore` mínimo: es el ejemplo más corto de una
implementación real de `TokenStore`. En producción va sobre tu BD, y **debe
persistir el refresh rotado en cada refresco** (ver el aviso del README raíz).

Al terminar, borra el client de prueba del tenant si no lo vas a reutilizar.
