# Changelog

Historial de versiones del monorepo. Los dos SDKs (`@pimia/sdk` y
`pimia/pimia-php`) versionan juntos: un tag `vX.Y.Z` en este repo corresponde
a la misma versión en ambos paquetes.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado es [SemVer](https://semver.org/lang/es/). En 0.x la API
pública puede cambiar entre minors.

## [0.9.0] — 2026-08-25

**Las altas devuelven `201`, y la deuda de banca queda cerrada.** Sale pegada a
la 0.8.0 —el arreglo del `201` en el núcleo llegó justo después de tagearla, y
no merecía la pena que el contrato siguiera mintiendo una versión más— y de
paso se lleva lo que la 0.8.0 dejó abierto: los enums y los filtros de banca,
los diez importes derivados que seguían siendo texto y los ids de los partes.

Con esto se cierra [#41](https://github.com/Pimia-AI/pimia-sdks/issues/41),
que llevaba tres versiones pidiendo el contrato al día.

Spec sincronizado con **factSaas@42382923** (2026-08-25) — **357 operaciones**,
una más que la 0.8.0.

### Añadido

- **`POST /expenses/{expense}/receipt`**, y con ella la capacidad que faltaba:
  adjuntar el justificante a un gasto que **ya existe** no se podía hacer desde
  ningún cliente del contrato. `PUT /expenses/{id}` se publicaba como multiparte
  y no puede cumplirlo —PHP solo puebla `$_FILES` en un `POST`, así que el
  fichero se perdía y la respuesta era **un 200 sin una palabra**—, y la otra
  puerta pide base64 y rechaza el PDF que el propio alta sí admite.

  Multiparte, campo `receipt`, y **resubir reemplaza en vez de acumular**. El
  `PUT` con multiparte ahora responde 422 diciendo dónde está la puerta buena,
  en vez de tragarse el fichero.

- **Banca deja de ser opaca**, que era lo único que impedía cerrar la #41:

  - `BankTransaction.status` publica **`pending | matched | reconciled |
    ignored`** y `.type` **`credit | debit`**, cada uno con la prosa de qué
    significa. El ciclo de conciliación es la mitad de la lógica del módulo y
    había que ir a leer el núcleo para conocer sus valores.
  - **`GET /banking/transactions` declara sus seis filtros** —
    `bank_account_id`, `status`, `type`, `from_date`, `to_date`, `per_page`—,
    `GET /banking/summary` el suyo, y `POST /banking/auto-match` lo lleva en el
    cuerpo. Antes los tres publicaban `parameters: []` mientras el controlador
    leía seis: quien generaba un cliente del contrato **no veía que se podía
    filtrar**.
  - `bank_account` y `reconciliations[]`, que el listado carga siempre y viajan
    en cada fila, por fin están en el schema de `BankTransaction`.

  ⚠️ Con los filtros llega su validación: un `status` o un `type` que no existe
  ahora da **422** en vez de devolver la lista entera sin filtrar — que es lo
  que evita el «pedí los pendientes y me los dio todos». `per_page` acepta de 1
  a 200.

### Cambiado

- ⚠️ **31 operaciones pasan de `200` a `201`.** Son las altas que devuelven el
  recurso recién creado: presupuestos, gastos, tareas, obras, usuarios, roles,
  series, plantillas, los cinco módulos de RRHH, los tres clonados y el alta de
  festivo.

  Nada cambia en el servidor: la API contestaba `201` desde siempre. Lo que
  cambia es el spec, que publicaba `200` porque el generador no puede saber el
  código — lo pone Laravel al ver `wasRecentlyCreated` en el modelo, y eso solo
  se sabe ejecutando la acción
  ([factSaas#435](https://github.com/galeote/factSaas/issues/435)).

  **Qué hacer**: si tipas la respuesta por su código, **regenera** — el cuerpo
  vive ahora bajo el `201`. Si compruebas `status === 200`, acéptale también el
  `201`; `PimiaClient` ya trata como éxito cualquier `2xx`, así que quien use el
  cliente no tiene nada que tocar. **El cuerpo no cambia**: el mismo recurso, en
  el mismo sobre `{data: …}`.

- 🔬 **Y ocho altas siguen en `200` a propósito**, que es lo que más sorprende:
  **cliente, factura, artículo, cobro, proveedor, factura recibida**,
  `item-categories` y `sepa-remittances`. Sus controladores no devuelven el
  modelo que acaban de crear sino una lectura posterior con las relaciones
  cargadas, y sobre esa instancia Laravel ya no responde `201`. Ahí el contrato
  **ya decía la verdad**. Si tu código las trataba como «altas de 201», nunca lo
  fueron.

- `POST /appointments` publica **los dos** códigos, como ya hacía: devuelve
  `200` con `duplicate: true` si la cita ya existía y `201` si la crea.

- **Trece propiedades más dejan de viajar como texto**, con el mismo criterio de
  la 0.8.0 — céntimos enteros:

  | | antes | ahora |
  |---|---|---|
  | `summary.pending\|matched\|reconciled\|ignored` | `string` | `integer` |
  | los seis `effective_*` y `credited_*` de `InvoiceResource` | `string` | `integer` |
  | los dos `effective_*` de `InvoiceSummaryResource` | `string` | `integer` |
  | los tres accessors de `InvestmentAssetResource` | `string` | `integer` |
  | `RecurringInvoiceResource.discount` | `string` | `number` |
  | `import/presets` → `data` | `unknown[]` | `string[]` |

  🔬 **Y no era solo el contrato**: los seis netos de rectificativa devolvían
  `float`, así que la respuesta traía `effective_total: 121000.0` junto a
  `total: 121000` sobre columnas que son céntimos enteros. Se arreglaron los dos
  lados, o sea que además del tipo cambia lo que llega por el cable.

  `RecurringInvoiceResource.discount` va a `number` y no a `integer` a
  propósito: con `discount_type = percentage` es un porcentaje, y un `10,5 %`
  truncado a `10` sería otro descuento.

  ⛔ `effective_base_due_amount` es **`integer | null`**, y el `null` importa:
  ahí el hueco no es un cero. Una factura que no ha calculado su deuda en moneda
  base no es una factura que no deba nada — es el bug que vació el panel de
  pendientes teniendo 368 facturas detrás.

- **`InvoiceItemResource.time_entry_ids` pasa de `object` a `integer[]`.** Era
  el defecto que se reportó al publicar la 0.8.0: el `POST` y el `PUT` lo
  declaraban `integer[]` —allí el tipo sale de las reglas de validación— y la
  lectura salía como objeto, así que **el round-trip que la propia descripción
  del campo manda hacer** (leer los ids de la ficha y reenviarlos al editar) no
  compilaba.

- `GET /absences/team-calendar` publica el formato de `month` y su `422`. Antes
  un `month=hola` daba 500.

### Corregido

- 🔴 **`Ok<>` miraba solo el `200`, y con el `201` habría degradado a `never`
  sin un solo error de compilación.** El helper que saca el tipo de la respuesta
  del OpenAPI llevaba el código escrito a mano, así que `customers.create` y
  `estimates.create` se habrían quedado sin tipo — y el SDK habría compilado y
  publicado igual. Un fallo silencioso del peor tipo: no hay nada que leer, solo
  un editor que deja de autocompletar.

  Comprobado que **no era hipotético**: con `bank-accounts.store`, que ya
  publicaba `201` desde antes, el helper viejo resolvía a `never`. Llevaba así
  desde que esa ruta entró en el contrato; no se notó porque `client.ts` no la
  expone.

### Nota para quien actualice desde la 0.8.0

Dos cosas que el `tsc` va a señalar y conviene mirar antes:

1. **Los códigos.** Si tipas por `200`, las 31 altas de arriba ya no lo llevan.
2. **Los trece tipos.** Si formateabas `effective_total` con `parseFloat`, ahora
   es un entero de céntimos como su hermano `total` — y si comparabas
   `time_entry_ids` como si fuera un objeto, ahora es una lista.

La regla del dinero no cambia: **todo importe de facturación es un entero en
céntimos, salvo los tres de banca, que son euros decimales en `string`.**

## [0.8.0] — 2026-08-25

El contrato al día, y con él la deuda de tipos saldada. Se sincroniza el spec
con `origin/main` del núcleo —**factSaas@c825948a**, 2026-08-25, **356
operaciones**— después de tres versiones con el de la 0.6.0 (314). Entran **42
operaciones** y **no desaparece ninguna**, pero esta no es una release
aditiva: **172 propiedades dejan de viajar como texto**. Los `id` son números
y los importes son céntimos enteros, que es lo que la API devolvía todo el
tiempo mientras el contrato lo describía mal.

Lo que la desbloqueó fue arreglar el núcleo, no rodearlo: el artefacto traía
**tres `operationId` repetidos** y `openapi-typescript` valida antes de
generar, así que desde el 22 de agosto no se podían regenerar los tipos
([factSaas#477](https://github.com/galeote/factSaas/issues/477), cerrada por
[factSaas#507](https://github.com/galeote/factSaas/pull/507)).

### Cambiado

- 🔴 **172 propiedades pasan de `string` a `integer`, en 42 schemas.** Es el
  cambio incompatible de esta versión y hay que leerlo entero antes de subir
  la dependencia. Se parte en dos mitades:

  - **93 son `id` y `*_id`** (el propio `id` en **21 `*Resource`**:
    `TaskResource`, `LeadResource`, `ProjectResource`, `TimeEntryResource`,
    `RoleResource`, los tres `*SummaryResource`…). Quien compare con `===`
    contra una cadena, o construya una clave de React con el `id`, tiene aquí
    su trabajo. Los identificadores **fiscales** no se tocan: `tax_id` y
    `national_id` son cadenas de verdad y siguen siéndolo.

  - **79 son importes y contadores**: `due_amount` y todos los `base_*` de
    facturas, presupuestos, recibidas y recurrentes; los cuatro totales de los
    `*SummaryResource`; `PaymentResource.amount`, `ExpenseResource.amount`,
    `TaxResource.base_amount`, `ItemsRequest.price`. **Van en céntimos**, como
    los `total` que ya eran enteros. Hasta aquí el mismo recurso mezclaba los
    dos tipos en una sola respuesta —`total: 12100` junto a
    `base_total: "121.00"`—, que era lo que hacía imposible escribir un
    formateador que no se equivocara en algún sitio.

  ⚠️ **La banca es la excepción y sigue en euros**, no en céntimos
  ([factSaas#442](https://github.com/galeote/factSaas/issues/442)):
  `BankAccount.opening_balance`, `.balance` y `BankTransaction.amount` siguen
  siendo `string` decimal, ahora con la descripción que lo dice. Es el sitio
  donde el MCP ya se equivocó una vez.

- **9 propiedades pasan de `string` a `boolean`** —`is_default`, `is_active`,
  `is_system`, `aeat_registered`, `enable_portal`, `send_automatically`— y
  **104 ganan su `| null`**, que antes se prometían siempre presentes y
  llegaban vacías.

### Añadido

- **42 operaciones**, ninguna retirada. Las que mueven algo:

  - **`GET /crm/assignable-users`** (scope `crm:read`, devuelve
    `{data: [{id, name}]}`), que es lo que esta issue lleva pidiendo desde la
    0.6.0: el selector de responsables de tareas y leads deja de tirar de
    `GET /employees`, porque **una ficha de personal no es una cuenta**.
  - **El dominio `admin` entero**: `users` (los seis verbos), `roles` y
    `roles/{role}/abilities`, `GET /abilities`, los módulos de instancia
    (`GET /tenant-modules`, install y disable) y la configuración de correo
    (`GET`/`POST /mail/config`, `GET /mail/drivers`, `POST /mail/test`).
  - **El OCR**: `POST /ocr/extract` y su alias para la app móvil
    `POST /smart-ocr/process`, los dos con el multiparte **tipado**
    (`OcrExtractRequest`: campo `document` o `file`, mimes y tope de 10 MB) y
    scope `ocr:write`, nuevo en el catálogo.
  - **Las descargas e informes dentro del contrato**: `/exports/*` (facturas,
    recibidas, gastos, libros registro, catálogo de artículos y su plantilla,
    remesa SEPA), `/reports/*` y los tres PDF de documento.
  - **Dos huecos de CRUD** que daban 404 y ahora existen:
    `DELETE /recurring-invoices/{id}` y `GET /item-categories/{id}`
    ([#34](https://github.com/Pimia-AI/pimia-sdks/issues/34), en parte).

- **`items.*.time_entry_ids`** en los dos verbos de facturas, con su semántica
  escrita: es lo que hay que **reenviar en el `PUT`** para que la línea
  conserve sus partes de tiempo. Sin ese campo, editar una factura le soltaba
  los partes.

- **`GET /customers/{id}/pending-time-entries` con su forma real**: `entries`
  era `string` y ahora es la lista de objetos que devuelve —`id`, `date`,
  `duration_minutes`, `hourly_rate_cents`, `amount_cents`—, y su `item_id`
  pasa de `string` a `integer | null`.

- **Siete schemas de petición nuevos**: `UserRequest`, `DeleteUserRequest`,
  `RoleRequest`, `RoleAbilitiesRequest`, `OcrExtractRequest`,
  `MailEnvironmentRequest`, `TenantModuleInstallRequest`.

- El NIF del cliente se llama **`tax_id`** —la columna se renombró en el
  núcleo— con `maxLength: 20` y descripción, y en los tres schemas de cliente
  es `string | null`.

### Corregido

- 🔴 **Las 18 operaciones que publicaban su `200` como un objeto opaco ya no
  existen: quedan cero.** Entre ellas `POST /invoices`, `PUT /invoices/{id}`,
  `PUT /customers/{id}`, `POST /estimates/{id}/convert-to-invoice` y
  `POST /invoices/{id}/credit-note` — o sea, casi todas las escrituras que un
  integrador hace de verdad, que hasta hoy devolvían un tipo sin una sola
  propiedad. Se cierran también los dos casos que declaraban `string` y
  devuelven JSON: **`GET /me/settings`** y `GET /legal-reports/pdf`.

- **45 campos binarios salen como `Blob`** (en la 0.7.0 eran nueve): el
  `transform` del generador cubre ahora todo el multiparte que entró con las
  descargas y el OCR.

### Pendiente

- ⚠️ **Los enums y los filtros de banca no entran**, y conviene saberlo porque
  la [#41](https://github.com/Pimia-AI/pimia-sdks/issues/41) los pedía:
  medido contra este spec, `BankTransaction.type` y `.status` siguen siendo
  `string` pelado (los valores son conjuntos cerrados: `credit|debit`,
  `pending|matched|reconciled|ignored`), y `GET /banking/transactions`,
  `GET /banking/summary` y `POST /banking/auto-match` siguen **sin declarar un
  solo parámetro** de consulta, mientras el controlador lee seis. Sigue
  reportado al núcleo.

- ⚠️ **`InvoiceItemResource.time_entry_ids` se publica como `object`** y lo que
  viaja es una lista de ids. El campo está y su prosa es correcta; el tipo, no
  —sale como `Record<string, unknown>` en vez de `number[]`—, así que el
  round-trip que la propia descripción manda hacer (leer los ids de la ficha y
  reenviarlos en el `PUT`) **no compila**. En el `POST` y el `PUT` el tipo sí
  es correcto: es solo la lectura.

- ⚠️ **Diez importes de facturación se quedan en `string`** cuando sus hermanos
  del mismo schema ya son enteros: los seis `effective_*` y `credited_*` de
  `InvoiceResource`, los dos `effective_*` de `InvoiceSummaryResource`,
  `RecurringInvoiceResource.discount` y `InvestmentAssetResource.net_book_value`.
  O sea que `InvoiceResource` mezcla ahora `total: 12100` con
  `effective_total: "121.00"` — la misma incoherencia de antes, en un rincón
  más pequeño.

- ⚠️ **La mitad `delegation` del catálogo OAuth sigue sin abrirse**
  ([#33](https://github.com/Pimia-AI/pimia-sdks/issues/33)): `ocr:write` entra,
  pero `delegation:write` sigue fuera de `securitySchemes`,
  `POST /tasks/{task}/delegate` sigue sin `security` propia, y su descripción
  sigue diciendo que el Authorization Server no emite ese scope, cuando desde
  factSaas#431 sí lo emite.

- 🔴 **[factSaas#435](https://github.com/galeote/factSaas/issues/435) (el `200`
  de las creaciones pasando a `201`) NO va en este tren.** Es un cambio que
  rompe y está esperando decisión sobre si sube. Si se decide que sí, es otra
  release y con su propia nota — no se cuela en esta.

- El SDK de **PHP** sigue sin `multipart` ni `download()`: `Transport::send`
  declara `?string $body` y admitirlos cambia una interfaz pública que un
  partner puede haber implementado. Va aparte.

### Nota para quien actualice desde la 0.7.0

El `tsc` es el que manda aquí: **172 propiedades cambian de tipo** y el
compilador las señala una a una. El patrón que más va a saltar es comparar un
`id` con una cadena y formatear un importe con `Number(v)` sobre algo que ya
es número.

La regla nueva, en una línea: **todo importe de facturación es un entero en
céntimos, salvo los tres de banca, que son euros decimales en `string`.** Si
tenías un `parseFloat` genérico para el dinero, ahora divide por 100 en un
sitio y no en el otro.

Y lo que **no** cambia: `spec/README.md` describía 87 monetarios `string` y
112 claves `id` como cadena. Ese texto era de la 0.6.0 y se ha reescrito con
lo que mide este contrato.

## [0.7.0] — 2026-08-24

Los ficheros. Hasta aquí el cliente **no podía subir ni descargar ninguno**, y
las dos veces fallaba en silencio; son diez operaciones del contrato para
subir y dos para descargar. El spec **no se mueve** en esta versión —sigue el
de la 0.6.0, factSaas@8552f60a, 314 operaciones— porque el artefacto nuevo del
núcleo trae dos `operationId` duplicados y el generador de tipos lo rechaza:
[factSaas#477](https://github.com/galeote/factSaas/issues/477). El contrato al
día va en la siguiente.

### Corregido

- 🔴 **`@pimia/sdk` no podía llamar a ninguna operación `multipart/form-data`,
  y fallaba en silencio.** El cliente pasaba **todo** cuerpo por
  `JSON.stringify` y le fijaba `content-type: application/json`, así que un
  `FormData` salía por el cable como la cadena `"{}"`. Y como `body` es
  `unknown`, la llamada **compilaba**: el fichero desaparecía sin un solo aviso
  y el servidor contestaba 422 sobre un campo que el cliente sí había mandado.

  Medido contra la 0.6.0 publicada, con un `fetch` de mentira:

  ```
  cuerpo enviado: "{}"
  content-type  : application/json
  ```

  Son **diez operaciones del contrato**, y entre ellas las que sostienen el
  círculo de compras: el justificante de un gasto (`POST`/`PUT /expenses`), el
  documento de una factura recibida
  (`POST /received-invoices/{id}/upload/document`), la importación de un
  extracto bancario (`POST /banking/import`), el membrete de una plantilla, el
  certificado de firma y el avatar de la empresa.

  Ahora un `FormData` viaja **tal cual** y **sin `content-type`**, para que el
  runtime escriba el suyo con su `boundary`. Pasan igual `Blob`,
  `URLSearchParams`, `ArrayBuffer` y sus vistas. Un `ReadableStream` **no**, a
  propósito: el cliente reintenta ante un 401 y ante un 429, y un cuerpo de un
  solo uso reventaría en el reintento con un error que no se parece a su causa.

  ⚠️ Y si alguien le pone `content-type` a mano a un `FormData`, ahora se
  **rechaza con un `TypeError` que lo explica** en vez de mandarlo: sin el
  `boundary` el servidor no puede separar las partes, y el 422 resultante manda
  a buscar el fallo donde no está.

- 🔴 **Los campos de fichero se tipaban como `string`.** `openapi-typescript`
  traduce `format: binary` a `string`, y en este contrato eso son **nueve**
  sitios: siete campos de un cuerpo multipart y dos respuestas
  `application/octet-stream`. El tipo afirmaba que un fichero se sube mandando
  texto —no se puede— y, al revés, quien tuviera un `File` y quisiera hacer lo
  correcto **no compilaba**.

  Ahora salen como **`Blob`**, que vale para las dos direcciones (`File`
  extiende `Blob`). Lo hace un `transform` en
  `typescript/scripts/generate-types.mjs`, que sustituye a la línea de CLI
  porque ese hook solo existe en la API de Node; el script **falla** si el
  transform no toca nada, para que un cambio del generador no devuelva los
  nueve campos a `string` sin que nadie se entere.

  Es un cambio de tipos publicados, pero no rompe ninguna llamada que hoy
  funcione: hasta esta versión el cliente no sabía mandar multipart.

- 🔴 **Y la mitad simétrica: una descarga se corrompía en silencio.** Las dos
  operaciones que devuelven un fichero —el membrete de una plantilla y el
  documento escaneado de una factura recibida, ambas
  `application/octet-stream`— se leían con `response.text()`, así que un PDF
  llegaba entero de tamaño y no se abría. El peor final posible para una
  descarga: no hay error que mirar.

  Entra **`client.download(path)`**, que devuelve un `Blob` y pide `accept:
  */*` (con `application/json` fijo, un servidor que negocie el tipo tendría
  derecho a contestar 406). Los **errores se siguen leyendo como JSON** aunque
  se pida un blob: cuando la API falla contesta su sobre de error, no el
  fichero.

  Sale con nombre propio y no como una bandera de `get()` a propósito: una
  corrupción silenciosa no puede depender de que alguien se acuerde de poner
  un parámetro.

### Añadido

- **`toFormData(campos)`**, que arma el cuerpo con las conversiones que el
  servidor espera y que `FormData` sola no hace: los booleanos van como `1` y
  `0` (un `"false"` PHP lo lee como verdadero), los objetos y arrays como
  cadena JSON, y `null`/`undefined` **se omiten** en vez de viajar como la
  cadena `"null"`. Las tres reglas están escritas en el propio spec, en
  `ExpenseRequest`.

### Pendiente

- El SDK de **PHP** tiene la misma limitación (`json_encode` incondicional en
  `PimiaClient::request`), y allí el arreglo es mayor: `Transport::send`
  declara `?string $body`, así que admitir multipart cambia una **interfaz
  pública** que un partner puede haber implementado. Va aparte.

## [0.6.0] — 2026-08-22

El contrato al día. Se sincroniza el spec con `origin/main` del núcleo
—**factSaas@8552f60a**, 2026-08-22, **314 operaciones**— y se regeneran los
tipos. La 0.5.0 se publicó con un spec de **230**: 84 operaciones por detrás.
Tres SÍ hay que quitarlas del contrato (rutas de monedas que el núcleo ya no
sirve), así que hay un cambio incompatible pequeño y acotado.

### Añadido

- **Cinco scopes que el contrato ya exige y el SDK no nombraba**:
  `settings:read`, `store:read`, `hr:read`, `hr:write` y `webhooks:write`.
  Sin ellos, 66 de las 314 operaciones del spec pedían un permiso que no
  estaba en `SCOPES` / `Pimia\Scopes`, y había que escribir la cadena a mano.
  De paso, el SDK de PHP recupera `APPROVALS_WRITE` / `APPROVALS_SUBMIT`, que
  TypeScript tenía desde la 0.2.0 y allí faltaban: **las dos listas vuelven a
  ser la misma**.
- **Series de presupuesto** (`/estimate-series`, las cinco operaciones REST y
  el schema `EstimateSeriesRequest`): el equivalente de las series de factura,
  que el spec ya traía.
- **`sent_at`, `viewed_at` y `email_logs`** en factura y presupuesto (con su
  `EmailLogResource`, sin `token` ni `body`), `rejection_reason` en el
  presupuesto y en el cuerpo de `POST /estimates/{estimate}/status`, y la
  serie del presupuesto.

### Cambiado

- **El spec y los tipos de TypeScript, regenerados desde el núcleo.** La copia
  de `spec/pimia-api-v1.json` se había quedado muy atrás, así que `api.ts` no
  tipaba familias enteras: ausencias, empleados, calendarios y horarios de
  trabajo, fichajes y sus correcciones, incidencias, notas, tipos de impuesto,
  informes legales, ajustes de empresa, webhooks de `settings`, la tienda,
  `/me` y los PDF. Los schemas pasan de 93 a 123.
- **`GET /invoices/templates` y `GET /estimates/templates` tipan por fin su
  elemento**: `{ name, path, custom }` en lugar de un array de `unknown`.
  `name` es lo que aceptan `template_name` al crear o editar; `path`, la URL
  absoluta de la miniatura (cadena vacía si no tiene); `custom` marca el
  diseño subido a la instancia, cuya miniatura viaja como data-URI.
- **Los tipos que ya había estaban mal**, por un defecto del generador del
  núcleo que se arregló allí
  ([factSaas#376](https://github.com/galeote/factSaas/pull/376)): Scramble lee
  las columnas del modelo con `Schema::getColumns()`, y el artefacto anterior
  se exportó **sin base de datos alcanzable**, así que cayó a `string` para
  todo y no marcó nada nullable. Ahora 192 propiedades `id`/`*_id` van como
  entero y muchas ganan su `| null`.

### Quitado

- **Tres rutas de monedas que el núcleo ya no sirve**:
  `GET /currencies/{currency}/active-provider`, `GET /supported-currencies` y
  `GET /used-currencies`. **El núcleo las retiró** porque las tres
  consultaban una tabla que ninguna migración crea y devolvían un 500
  ([factSaas#377](https://github.com/galeote/factSaas/issues/377)); hoy
  responden 404. Nunca llegaron a funcionar, así que quitarlas del contrato no
  rompe nada que funcionara — pero el tipo desaparece de `api.ts`, y por eso
  cuenta como el único cambio incompatible de esta versión.

### Corregido

- **`scripts/sync-spec.sh` leía el working tree del checkout del núcleo**, no
  `origin/main`. Con varios worktrees de factSaas a la vez ese checkout suele
  estar en otra rama —hoy, 148 commits por detrás—, y el script **retrocedía
  el contrato sin avisar**: así salió la 0.5.0, 84 operaciones vieja. Ahora
  hace `git fetch` y lee de `git show origin/main:docs/openapi/…` (`--ref`
  para otra rama), **aborta si el spec nuevo tiene menos operaciones** que el
  que ya está en el repo (`--force` para saltárselo, a propósito y
  explicándolo aquí) e imprime el commit del núcleo para anotarlo en este
  fichero.

### Nota para quien actualice desde la 0.5.0

Van a cambiar tipos que ya usaba —un `id` que pasa de `string` a `number`,
campos que ganan `| null`—. No es que cambie una firma del SDK: es el
artefacto del contrato midiendo bien lo que ya devolvía la API. Conviene mirar
el `tsc` antes de subir la dependencia.

**Lo que este spec todavía NO arregla, porque no es cosa del generador:**
siguen tipadas como `string` **112 claves** (`id` y `*_id`, sin contar los
identificadores fiscales, que sí son cadena) y **87 propiedades monetarias**.
Hay **21 `*Resource` cuyo propio `id` llega como cadena**. Ahí el spec no
miente, la API es la inconsistente: esos Resources devuelven columnas
`decimal(15,2)` sin cast y PDO las entrega como cadena. Solo `Invoice`,
`Estimate` y `ReceivedInvoice` castean `total`/`sub_total`/`tax` a entero —y
ninguno castea `due_amount` ni los `base_*`, así que el mismo recurso mezcla
los dos tipos en una respuesta—. Hasta que el núcleo ponga los casts, **un
monetario `string` es un decimal con dos cifras** (ver `spec/README.md`) y hay
que hacerle `Number(...)` al leerlo. Quedan además **16 operaciones cuyo `200`
se describe como un `object` sin propiedades** (`POST /invoices`,
`PUT /invoices/{invoice}`, `PUT /customers/{customer}`, `convert-to-invoice`…)
más `GET /me/settings`, que devuelve JSON y el spec declara `string`: el
cuerpo llega, pero el tipo generado no ayuda. Todo ello, abierto como issues
de este repo.

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
