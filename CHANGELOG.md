# Changelog

Historial de versiones del monorepo. Los dos SDKs (`@pimia/sdk` y
`pimia/pimia-php`) versionan juntos: un tag `vX.Y.Z` en este repo corresponde
a la misma versión en ambos paquetes.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado es [SemVer](https://semver.org/lang/es/). En 0.x la API
pública puede cambiar entre minors.

## [No publicado]

### Cambiado

- **El spec y los tipos de TypeScript, regenerados desde el core.** La copia de
  `spec/pimia-api-v1.json` se había quedado **82 operaciones por detrás** —230
  contra 312—, así que `api.ts` no tipaba familias enteras: ausencias,
  empleados, calendarios y horarios de trabajo, fichajes y sus correcciones,
  incidencias, notas, tipos de impuesto, informes legales, ajustes de empresa,
  webhooks de `settings`, la tienda, `/me` y los PDF. Ninguna operación
  desaparece y ningún schema se va (93 → 122): es **aditivo**.
- **Y los tipos que ya había estaban mal**, por un defecto del generador del
  core que se arregló allí el mismo día
  ([factSaas#376](https://github.com/galeote/factSaas/pull/376)): Scramble lee
  las columnas del modelo con `Schema::getColumns()`, y el artefacto anterior se
  exportó **sin base de datos alcanzable**, así que cayó a `string` para todo y
  no marcó nada nullable. En este spec eso se traduce en `id: string` donde la
  API manda enteros, propiedades opcionales sin `| null` y schemas de modelo
  vacíos. Ahora los tipos dicen lo que la API devuelve.
- **Campos nuevos del contrato** que entran con la regeneración: `sent_at`,
  `viewed_at` y `email_logs` en factura y presupuesto (con su
  `EmailLogResource`, sin `token` ni `body`), `rejection_reason` en el
  presupuesto y en el cuerpo de `POST /estimates/{estimate}/status`, y la serie
  del presupuesto.

⚠️ **Quien actualice desde la 0.5.0 verá cambiar tipos que ya usaba** —un `id`
que pasa de `string` a `number`, campos que ganan `| null`—. No es una firma que
cambie: es el contrato dejando de mentir. Conviene mirar el `tsc` antes de subir
la dependencia.

## [0.5.0] — 2026-08-10

Dos huecos que destapó el primer integrador real al reconstruir su puente sobre
`external_ref`. Todo **aditivo**: ninguna llamada existente cambia de firma ni
de comportamiento.

### Añadido

- **`externalRef` en `estimates.convertToInvoice()`.** El endpoint acepta
  `external_ref` en el cuerpo desde la 0.4.0 —es lo que hace que
  `invoice.created` e `invoice.paid` no lleguen con la referencia nula— pero el
  atajo no tenía por dónde mandarlo, así que había que bajar a `post()` crudo
  justo en el paso que cierra el bucle. En TS va como opción (`{ externalRef }`)
  y no como segundo parámetro, para no romperle la llamada a quien ya hace
  `convertToInvoice(id, { idempotencyKey })`; un `externalRef: null` explícito
  desvincula la referencia y omitirlo manda cuerpo vacío, como hasta ahora.
  **En PHP** es el tercer parámetro,
  `convertToInvoice($id, $idempotencyKey, $externalRef)`: con `null` (el
  defecto) el cuerpo va vacío — para el caso raro de desvincular
  explícitamente, la ruta cruda sigue ahí.
- **`ReadOptions` (`headers`, `signal`) en las lecturas** (TS): `get()`,
  `delete()` y los atajos de recurso (`customers.list/get`,
  `estimates.list/get`, `invoices.list/get`). Antes ninguno aceptaba opciones,
  así que **no había forma de ponerle un timeout a una lectura** sin abandonar
  los atajos e irse a `request()`. Y lo que pasa en la práctica es que nadie se
  va: un cliente que sondea se cuelga en un GET y deja de sondear sin dar un
  solo error. (En PHP no hay hueco equivalente: el cliente HTTP es PSR-18 y lo
  inyectas tú, así que el timeout se configura en tu implementación.)

## [0.4.0] — 2026-08-10

La versión de **`external_ref`**: tu identificador colgado del recurso de
Pimia, y consultable por él. Es la alternativa a la tabla `mapeo` que todo
integrador acaba manteniendo en su lado — y que se desincroniza en cuanto un
proceso se cae entre el `POST` y el guardado del mapeo.

Sale justo después de la 0.3.0 porque el contrato del core llegó más tarde ese
mismo día: la 0.3.0 se publicó sin nada de esto.

`@pimia/design-tokens` se publica en 0.4.0 **sin cambio alguno**: los paquetes
de este monorepo versionan en bloque.

### Añadido

- **`external_ref` en el contrato**, vía spec regenerado: opcional
  (`string|null`, máx. 255) en el alta de clientes, presupuestos y facturas y
  en el cuerpo de `POST /estimates/{id}/convert-to-invoice`; **siempre
  presente** (`string | null`) en los tres recursos; y filtro `?external_ref=…`
  en los tres listados. El alcance es tu client OAuth: dos integradores pueden
  usar la misma cadena sin pisarse y ninguno ve la del otro.

- **`DuplicateExternalRefError` / `DuplicateExternalRefException`** para el 422
  `external_ref_already_used`. Traen `existingId`, que es lo que convierte el
  choque en un **find-or-create sin mapeo local**: intenta crear con tu
  referencia y, si ya existía, el propio error dice cuál es.

  ```ts
  try {
    const { id } = await crearCliente({ name, external_ref: `deal_${dealId}` })
    return id
  } catch (error) {
    if (error instanceof DuplicateExternalRefError) return error.existingId
    throw error
  }
  ```

  Heredan del error de validación a propósito, y el cuerpo trae también el
  `errors` de siempre: quien ya trataba los 422 por ahí no necesita rama nueva.

- **`external_ref` en los payloads de webhook**, en los cinco eventos de
  recurso (`customer.created`, `customer.updated`, `invoice.created`,
  `invoice.paid`, `estimate.accepted`), en los dos SDKs. La clave viaja
  **siempre**, con `null` cuando no hay referencia — nunca ausente, para que el
  payload se pueda tipar; por eso es `string | null` y no opcional. Llega
  resuelta para el receptor: el emisor la calcula endpoint por endpoint, así
  que nunca ves la de otro integrador. Los otros tres eventos
  (`approval.decided`, `invoice.received`, `app.revoked`) no van sobre un
  recurso etiquetable y no la llevan.

- Tipo `ExternalRef` exportado en TypeScript, donde vive la explicación del
  campo.

### Cambiado

- El README documenta el patrón find-or-create y suma el error nuevo a la tabla
  de errores.

## [0.3.0] — 2026-08-10

La versión de los **webhooks**. Cierra la carencia que más código imponía a
cada integrador: hasta ahora el SDK no traía ni verificador de firma ni tipos
de payload —el spec declaraba `webhooks = Record<string, never>`—, así que
todo el que recibía eventos reescribía las mismas ~28 líneas de HMAC y
adivinaba la forma de lo que le llegaba.

`@pimia/design-tokens` se publica en 0.3.0 **sin cambio alguno**: los paquetes
de este monorepo versionan en bloque.

### Añadido

- **Verificador de webhooks y tipos de los 8 eventos del catálogo**, en los dos
  SDKs. Un receptor completo pasa a ser esto:

  ```ts
  import { verifyWebhook, WebhookVerificationError } from '@pimia/sdk'

  // OJO: express.raw(), no express.json() — ver más abajo.
  app.post('/pimia', express.raw({ type: 'application/json' }), async (req, res) => {
    let hook
    try {
      hook = await verifyWebhook({ secret: SECRET, headers: req.headers, body: req.body })
    } catch (error) {
      return res.status(400).send((error as WebhookVerificationError).reason)
    }

    if (hook.known && hook.event === 'estimate.accepted') {
      await facturar(hook.payload.id) // payload tipado, sin castings
    }

    res.sendStatus(200)
  })
  ```
  ```php
  $verifier = new Pimia\Webhooks\WebhookVerifier($secret);
  $hook = $verifier->verify($request->headers->all(), $request->getContent());

  match ($hook->event) {
      WebhookEvent::EstimateAccepted => $facturar($hook->payload['id']),
      default => null,
  };
  ```

  Comprueba, en este orden: las cuatro cabeceras
  (`x-pimia-signature`/`-timestamp`/`-event`/`-delivery`), que el timestamp esté
  dentro de la ventana anti-replay (300 s, configurable), que el HMAC-SHA256 del
  canónico `PIMIA-WEBHOOK-v1` cuadre —comparación en **tiempo constante**— y que
  el cuerpo sea JSON. Cada fallo llega con un `reason` legible por máquina
  (`signature_mismatch`, `timestamp_out_of_window`…): distinguir «me están
  atacando» de «tengo el reloj mal» importa para tus métricas.

  Tres decisiones que conviene conocer:

  - **Se firman los BYTES recibidos, no el objeto.** Parsear y volver a
    serializar da un objeto equivalente y otros bytes, y la firma deja de
    cuadrar sin que se vea por qué. Es la trampa número uno de estas
    integraciones, y hay un test dedicado a ella.
  - **Un evento que el SDK no conozca no es un error.** El catálogo del servidor
    puede crecer sin que actualices: la firma se verifica igual y la entrega
    llega con `known: false` (TS) o `event === null` (PHP). Con `known: true`, el
    `switch` sobre `event` narra al payload exacto de cada uno de los ocho.
  - **La deduplicación es tuya y el SDK no la finge.** Pimia reintenta hasta
    cinco veces; `delivery` es el mismo en todas y es tu clave de idempotencia.

  `secret` acepta también una **lista**, para rotar el secreto sin ventana de
  caída. Y se incluye `signWebhook()` / `WebhookVerifier::sign()` para que
  puedas testear tu receptor sin reimplementar el HMAC — que es justo lo que
  este módulo viene a evitar.

  Los payloads están tipados contra los emisores reales del core, no supuestos.
  Ojo con dos asimetrías que el tipo refleja tal cual: `invoice.received` no
  castea `id`, `sequence_number` ni `currency_id` en origen (llegan como número
  **o** cadena), y `invoice.paid` puede traer `due_amount` **negativo** si hubo
  sobrepago.

- **`estimates.convertToInvoice(id, { idempotencyKey })`** en los dos SDKs. Era
  el helper que faltaba para cerrar el bucle `estimate.accepted` → facturar, y
  obligaba a ir por ruta cruda. Documenta de paso dos cosas que el spec no dice:
  la factura nace **borrador y sin numerar** (`data.invoice_number` es `null`
  hasta que la publiques) y el id de la nueva factura está en `data.id` — el
  `r?.data?.id ?? r?.id` defensivo que circula por ahí tiene la segunda rama
  muerta.

### Cambiado

- **Los helpers tipados devuelven tipos del OpenAPI en vez de `unknown`.**
  `invoices`, `customers` y `estimates` (`list`, `get`, `create`, `update`)
  atan su respuesta a la operación correspondiente del spec, y sus cuerpos de
  escritura a `InvoicesRequest` / `CustomerRequest` / `EstimatesRequest` — que
  desde el spec de hoy **ya incluyen `customFields`**. Se exportan además
  `InvoiceResource`, `CustomerResource`, `EstimateResource` y los tres tipos de
  petición.

  Es un cambio **incompatible** si pasabas cuerpos que no encajan con el
  contrato: en 0.x los minors pueden romper. El escape sigue ahí — `client.post()`
  crudo no tipa nada.

  Cuatro de esas respuestas (`POST /invoices`, `PUT /invoices/{id}`,
  `PUT /customers/{id}`, `convert-to-invoice`) usan un `ResourceEnvelope<T>`
  declarado a mano en vez del tipo generado: su `200` sale del generador como
  objeto **vacío**, y `Record<string, never>` afirmaría que la respuesta no
  tiene propiedades, escondiendo el `data`. La forma está verificada contra los
  controladores del core.

- **El spec se regenera desde `origin/main` del core.** Entra la oleada 1 del
  plan de integradores: `customFields` declarado en las nueve escrituras que lo
  aceptan (incluida la forma por línea de `InvoiceItem`/`EstimateItem`),
  `payment_number` y `received_invoice_number` **opcionales** —los genera el
  servidor, como ya pasaba con `estimate_number`—, el contrato de
  `GET /next-number` saneado (parámetro `key` documentado y respuesta
  `{success, nextNumber, isUsed}` tipada, con el aviso de que no reserva nada
  ni es determinista) y las operaciones con scopes inconcedibles marcadas como
  no disponibles para integradores.

- **El starter kit deja de enseñar el apaño de `next-number`.** Pedía el número
  antes de crear el presupuesto y lo mandaba en el cuerpo: eso añadía una
  carrera que el servidor no tiene y rompía la reproducibilidad del cuerpo entre
  reintentos con `Idempotency-Key`. Ahora manda solo lo que decide él —cliente,
  fechas y líneas— y deja que el servidor numere y recomponga los totales. El
  cuerpo del ejemplo pasa de 20 campos a 4.

## [0.2.0] — 2026-08-09

Todo lo de esta versión es **aditivo**: nada de lo que funcionaba en 0.1.0
cambia de comportamiento ni de firma.

`@pimia/design-tokens` se publica en 0.2.0 **sin cambio alguno** respecto a
0.1.0: los paquetes de este monorepo versionan en bloque, así que el tag los
arrastra a todos.

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
