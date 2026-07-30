# Starter kit: app vertical sobre Pimia

App de ejemplo **completa y funcionando**: Next.js (App Router) + `@pimia/sdk`,
con la autenticación OAuth resuelta del lado del servidor. Sirve como punto de
partida para una app vertical con **tu marca, tu dominio y tu flujo** sobre la
facturación de Pimia.

La UI es fea a propósito: el white-label consiste en que pongas la tuya. Lo que
sí merece leerse línea a línea es `src/lib/` — ahí está lo que cuesta acertar.

## Qué trae resuelto

| Pieza | Dónde | Por qué importa |
|---|---|---|
| Flujo de autorización con PKCE | `src/app/login/route.ts` | `state` anti-CSRF y `code_verifier` en cookie httpOnly de 10 minutos |
| Callback y canje | `src/app/callback/route.ts` | Valida el `state`, canjea el código y **guarda los tokens en el servidor** |
| Sesión propia | `src/lib/session.ts` | Cookie firmada (HMAC) con el tenant y un id opaco; los tokens de Pimia **nunca** llegan al navegador |
| Almacén de tokens | `src/lib/tokens.ts` | La pieza a sustituir por tu BD; documenta la regla de la rotación |
| Cliente por petición | `src/lib/pimia.ts` | `client_secret` solo en servidor; traduce «token muerto» a «re-autoriza» |
| Desconexión limpia | `src/app/logout/route.ts` | Revoca en Pimia (RFC 7009), no solo borra tu cookie |
| Panel | `src/app/panel/page.tsx` | Facturas y clientes; enseña el 403 por scope en vez de esconderlo |
| Flujo vertical | `src/app/panel/presupuestar/` | Presupuestar una obra en dos campos; céntimos y errores 422 por campo |

## Puesta en marcha

### 1. Registra tu client en el tenant

Necesitas un client **confidencial** (esta app tiene servidor, así que puede
guardar un secret). Cámbiale `TENANT` y la URL de tu app:

```bash
curl -s https://TENANT.pimia.es/oauth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "client_name": "Reformas Vertical",
    "redirect_uris": ["http://localhost:3000/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "token_endpoint_auth_method": "client_secret_post",
    "scope": "invoices:read customers:read estimates:read estimates:write"
  }'
```

Guarda el `client_id` y el `client_secret` (**el secret se muestra una sola
vez**). Los scopes tienen que coincidir con `REQUESTED_SCOPES` de
`src/lib/config.ts`: pedir en el authorize algo que no concediste en el
registro es `invalid_scope`.

### 2. Configura el entorno

```bash
cp .env.example .env.local   # rellena PIMIA_* y APP_URL
openssl rand -base64 32      # para SESSION_SECRET
```

### 3. Arranca

```bash
# desde la raíz del monorepo: el SDK se enlaza por file: y hay que compilarlo antes
npm --prefix ../../typescript run build

npm install
npm run dev
```

Abre `http://localhost:3000`, pulsa **Conectar con Pimia**, autoriza en la
pantalla de Pimia y aterrizarás en el panel.

## Las cuatro cosas que no te puedes saltar

1. **El refresh token rota.** Cada refresco devuelve uno nuevo y mata el
   anterior; reusar uno rotado hace que Pimia revoque el grant completo. El SDK
   lo persiste solo, pero **solo si tu `TokenStore` guarda de verdad** (ver
   `src/lib/tokens.ts`). Con varias instancias, añade un lock por usuario.
2. **Un token = un tenant.** No hay token global: `/login?tenant=…` muestra el
   patrón. Si sirves a varios clientes, guarda su tenant en su alta.
3. **Los importes son céntimos**, enteros. `4.500,50 €` → `450050`.
4. **Las reglas de negocio son del servidor** y aplican igual a tu app y al
   panel de Pimia: una factura emitida no se borra (se rectifica), la cadena
   VeriFactu es inmutable, y los `422` traen los errores por campo. No intentes
   replicar esa lógica en tu app: consúmela.

## De aquí a producción

- **Sustituye `FileTokenStore` por tu base de datos.** Es lo único imprescindible.
- Sustituye la sesión de `src/lib/session.ts` por la que ya use tu app.
- Cambia la `redirect_uri` registrada a tu dominio de producción y usa
  cookies `Secure` (automático si `APP_URL` es `https://`).
- Trata `UnauthorizedError` como «pide autorización otra vez», no como error
  recuperable: significa que el usuario te revocó o el grant murió.
- Cuando `@pimia/sdk` esté publicado en npm, cambia la dependencia `file:` por
  la versión y borra `outputFileTracingRoot` de `next.config.mjs`.
