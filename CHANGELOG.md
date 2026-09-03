# Changelog

Historial de versiones del monorepo. Los dos SDKs (`@pimia/sdk` y
`pimia/pimia-php`) versionan juntos: un tag `vX.Y.Z` en este repo corresponde
a la misma versión en ambos paquetes.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado es [SemVer](https://semver.org/lang/es/). En 0.x la API
pública puede cambiar entre minors.

## [0.20.0] — 2026-09-03

**⚠️ CAMBIO INCOMPATIBLE DE SCOPE: proyectos, tareas y partes de horas dejan
`crm:*` y pasan a `work:*`.** Un grant vivo que solo pidió `crm:read`/`crm:write`
**deja de alcanzarlos**: hay que reconectar pidiendo también `work:*`. Ninguna
operación entra ni sale; lo que cambia es qué scope exige cada una.

Spec sincronizado con **factSaas@c2dcdd90** (2026-09-03) — **428 operaciones**,
las mismas que en la 0.19.0.

### Añadido

- **`SCOPES.workRead` / `SCOPES.workWrite`** (TS) y **`Scopes::WORK_READ` /
  `Scopes::WORK_WRITE`** (PHP): el dominio nuevo del catálogo OAuth. Se piden
  como cualquier otro de partner, con consentimiento del dueño.
- **`listed`** en cada módulo de `GET /tenant-modules`: dice si el módulo se
  OFRECE en el escaparate. Los dos de cumplimiento fiscal salen con `false` —su
  presencia la decide el país del emisor y no es mercancía—, así que una
  pantalla de módulos no debe pintarles botón de instalar ni de desactivar.
- **`403`** documentado en las operaciones de proveedores, facturas recibidas,
  cuentas bancarias, movimientos, remesas SEPA e inmovilizado: hasta ahora esas
  rutas no autorizaban nada y ya lo hacen, con permisos de grano fino por
  usuario.

### Cambiado

- **`work:read`** es el scope de `GET /projects`, `GET /tasks`,
  `GET /time-entries` y `GET /customers/{id}/pending-time-entries`; **`work:write`**
  el de sus escrituras. `POST /tasks/{task}/delegate` pasa a exigir
  `work:write` + `delegation:write` (era `crm:write` + `delegation:write`) y
  sigue reservada al panel de Pimia.
- **`crm:read` / `crm:write`** se quedan con las OPORTUNIDADES: leads, su
  embudo, su actividad comercial, la conversión a cliente y
  `GET /crm/assignable-users`. Sus textos de consentimiento cambian en
  consecuencia.

### Cómo migrar

1. Añade `work:read` (y `work:write` si escribes) a los scopes que pide tu app.
2. **Manda a reconectar a los usuarios cuyo grant sea anterior.** El grant viejo
   no gana el dominio nuevo solo: hasta que el dueño vuelva a autorizar, tus
   llamadas a proyectos, tareas y tiempos responden `403`.
3. Si solo lees leads, no tienes que hacer nada.

El porqué, en una línea: leads y trabajo son dos consentimientos distintos. Una
herramienta de prospección no tiene por qué leer las horas que el equipo imputa
a cada obra, y una de gestión de obra no tiene por qué ver el embudo comercial.
Núcleo en galeote/factSaas#677 (épica de composición de los módulos internos).

### Lo que hay que tener delante para integrarlo

- `@pimia/design-tokens` sube a 0.20.0 **sin cambios de código**.
- El cambio es del CATÁLOGO, no del código del SDK: llamar a
  `client.projects.list()` con un token que no lleve `work:read` responde `403`
  con `Token lacks the work:read scope`.

## [0.19.0] — 2026-09-03

**Contratar tras bajar a Free reanuda la suscripción en vez de abrir otra.**
Una operación cambia de forma; ninguna entra ni sale.

Spec sincronizado con **factSaas@2fac3afa** (2026-09-03) — **428 operaciones**,
las mismas que en la 0.18.0.

### Cambiado

- **`POST /billing/checkout`** (primera parte) publica ahora
  `data: {checkout_url: string|null, resumed: boolean, plan: string|null}`.
  Con `resumed: true` no hay Checkout de Stripe al que ir: el pagador tenía una
  suscripción cancelada a fin de periodo (bajó a Free y se arrepintió) y el
  núcleo la reanudó, recreó el asiento y cambió el plan al instante —
  `checkout_url` es `null` y `plan` dice a cuál. Núcleo en
  galeote/factSaas#674, medido en dev con el panel: antes, el segundo
  «Contratar» abría una segunda suscripción y el solape se cobraba dos veces.
  Error nuevo: `502 stripe_resume_failed` (Stripe no dejó reanudar; no se abre
  un checkout encima).

### Lo que hay que tener delante para integrarlo

- ⚠️ `checkout_url` pasa de `string` a `string|null`: quien redirigía a ciegas
  tiene que mirar `resumed` primero. Sigue siendo una operación reservada al
  panel de Pimia (`first-party-only`), así que ningún integrador la consume.
- `pimia/pimia-php` y `@pimia/design-tokens` suben a 0.19.0 **sin cambios de
  código**.

## [0.18.0] — 2026-09-03

**El plan y la contratación de la instancia, para el panel de Pimia; y el
contrato al día con la facturación francesa y el alta por país.** Trece
operaciones nuevas, ninguna retirada.

Spec sincronizado con **factSaas@c6370f9b** (2026-09-03) — **428 operaciones**
(415 en la 0.17.0).

### Añadido

- **`/billing/*`, cinco operaciones de PRIMERA PARTE** (galeote/factSaas#673):
  `GET /billing/plans` (el catálogo contratable, sin los planes de canal),
  `GET /billing/subscription` (el plan de la instancia con sus límites
  efectivos, el consumo del mes, la prueba, quién paga y el estado en Stripe),
  `POST /billing/checkout` (la URL del Checkout de Stripe), `POST /billing/portal`
  (la URL del portal de Stripe) y `POST /billing/change-plan`. Exigen
  `billing:read` / `billing:write`, que el Authorization Server emite **solo al
  client del panel web de Pimia**: un integrador ve las operaciones en el spec,
  marcadas `x-pimia-partner-availability: first-party-only`, y no puede pedir
  el scope. `SCOPES` no los ofrece, a propósito.
- **La facturación electrónica francesa**, del bloque #658 del núcleo:
  `GET`/`PUT /settings/fr` (régimen de TVA, TVA sobre débitos, naturaleza de
  operación por defecto; tras la puerta del módulo `compliance-fr`),
  `GET /settings/fr/ereporting/{transactions,reports}` (la cola del
  e-reporting, solo lectura), `GET /invoices/{invoice}/einvoice` (el Factur-X)
  y `POST /received-invoices/{received_invoice}/einvoice/{approve,refuse}`
  (lo que el receptor decide sobre una factura llegada por la plateforme), con
  `InboundEInvoiceResource` y `RefuseInboundEInvoiceRequest`.
- **`GET /invoices/{invoice}/fiscal`**, el estado fiscal NEUTRO de una factura
  (galeote/factSaas#666): el mismo bloque para VeriFactu y para Factur-X.
  Viaja también como `fiscal` en `InvoiceResource`.
- Campos nuevos, todos opcionales: `country_code`, `registration_number` y
  `tax_regime` en la empresa (`CompanyRequest`/`CompanyResource`/
  `CurrentCompanyResource`); `registration_number` (el SIREN) en el cliente;
  `operation_nature` en la factura y en su alta; `vat_category` y
  `vat_exemption_code` (EN 16931) en el tipo de impuesto; `einvoice` en la
  factura recibida.

### Cambiado

- `GET /invoices/{invoice}/verifactu/detail` publica solo su `200`: el detalle
  va a un nivel (galeote/factSaas#647). `GET /invoices/{invoice}/facturae`
  documenta el `422` de una factura sin emitir (#669). `aeat_csv` y
  `aeat_status` de `InvoiceResource` ganan tipo (#639).
- `TaxTypeRequest.percent` afina su tipo; `UserResource.companies` cambia la
  forma de sus elementos (el rol de cada empresa, #672).

### Lo que hay que tener delante para integrarlo

- ⛔ **`/billing/*` no es para un integrador.** Está en el contrato para que
  el panel de Pimia tipe contra él; un token de partner recibe `403`. Lo que
  sí puede leer un integrador del plan es el `403 feature_not_available` y el
  `403 plan_limit_exceeded` de siempre.
- `pimia/pimia-php` sube de versión **sin cambios de código**: las
  operaciones nuevas viajan por tipos generados que en PHP son arrays, y
  `Scopes` no gana constantes porque ninguno de los dos scopes es pedible.
  `@pimia/design-tokens` va a 0.18.0 también sin cambios.

## [0.17.0] — 2026-09-01

**El sello de exportación contable, y los cuatro campos del impuesto que no
tenían camino de escritura.** Dos superficies aditivas del núcleo; ninguna ruta
nueva y ninguna retirada.

Spec sincronizado con **factSaas@cb5def1f** (2026-09-01) — **415 operaciones**,
las mismas que en la 0.16.0.

### Añadido

- **`export_batch_id`** en `Invoice`: el lote de exportación contable que selló
  el documento, o `null` si sigue pendiente. Viaja en las tres operaciones que
  publican el modelo —`GET /dashboard` (`recent_due_invoices`),
  `GET /sepa-remittances/eligible-invoices` y `GET /invoices/verifactu`— y
  dentro de `DeliveryNoteResource.invoice`. Núcleo en galeote/factSaas#614.
- **`exported_at`** pasa a declararse `format: date-time` en `Invoice`. Ya
  viajaba; lo que no traía era el formato, así que quien generaba tipos del
  spec la recibía como `string` pelado en vez de como fecha.
- **Cuatro campos opcionales en `TaxTypeRequest`** — `tax_category`,
  `tax_scope`, `is_default` y `aeat_model`. Núcleo en galeote/factSaas#616
  y #617.

### Lo que hay que tener delante para integrarlo

- ⛔ **Sin `tax_category`, un IRPF dado de alta por la API se guardaba como
  IVA.** Un porcentaje negativo NO basta para que un tipo cuente como
  retención: lo decide esa clave, y hasta ahora el contrato no la admitía en la
  escritura, así que no había forma de mandarla. Si tu integración crea tipos
  de impuesto, es el campo que te faltaba — y el que decide si el importe entra
  en el 303 o en el 111/115.
- **`export_batch_id` es de SOLO LECTURA.** Lo estampa la exportación por lotes
  de la gestoría; no hay endpoint que lo escriba ni columna que pisar.
- ⚠️ **Su `null` significa dos cosas distintas**: que el documento está
  pendiente de exportar, o que lo selló un lote anterior a que existiera la
  columna. No sirve para reconstruir el histórico de exportaciones.
- `pimia/pimia-php` sube de versión **sin cambios de código**: el versionado es
  en bloque, y estos campos viajan por tipos generados que en PHP son arrays.
  `@pimia/design-tokens` va a 0.17.0 también sin cambios.

## [0.16.0] — 2026-08-31

**El stock comprometido.** El almacén ya sabía cuánto tienes, quién lo movió y
dónde está; desde hoy sabe además **cuánto de eso ya tiene dueño** — y por
tanto cuánto puedes vender de verdad. Pieza 3 y última de la fase N2 del
estudio de stock; núcleo en galeote/factSaas#596.

Spec sincronizado con **factSaas@869b4deb** (2026-08-31) — **415 operaciones**,
las mismas: la pieza no estrena ni una ruta. Ninguna retirada.

### Añadido

- **`committed_quantity`** en el artículo (`ItemResource` e
  `ItemSummaryResource`): lo que ese artículo tiene comprometido por documentos
  que aún no han movido el almacén.
- **`meta.committed`** en `GET /items/{item}/stock-movements`: la cantidad, el
  **disponible** (saldo − comprometido) y el **desglose documento a
  documento** — qué albaranes y qué facturas lo comprometen, con su número,
  su cliente y su fecha.
- **`item_committed_quantity`** en las filas de
  `GET /warehouses/{warehouse}/stock`. El `item_` del nombre no es adorno: la
  fila habla de una nave y la cifra es del ARTÍCULO entero.
- **`client.stockMovements`** en `@pimia/sdk` y **`$client->stockMovements`**
  en `pimia/pimia-php`: `list`, `forItem` y `adjust`. El libro llevaba desde
  N1 sin atajo en los SDKs, y es donde vive el comprometido.

### Lo que hay que tener delante para integrarlo

- ⛔ **Es una cifra DERIVADA. No hay nada que escribir.** No existe un endpoint
  para reservar ni una columna que pisar: el comprometido se calcula leyendo
  los documentos cada vez que se pregunta. Si tu integración necesita
  «reservar», lo que crea es un **albarán o una factura en borrador**.
- **Qué compromete, exactamente**: el albarán en borrador y la factura en
  borrador. Los dos dejan de comprometer **solos** en cuanto mueven el almacén
  (al marcar entregado y al publicar). El **presupuesto aceptado NO
  compromete**: nada en el núcleo dice cuándo se cumplió, así que contarlo
  sería una cifra que solo sube.
- ⚠️ **`null` NO es cero**, ni en `committed_quantity` ni en `meta.committed`.
  Es «no se está calculando»: la empresa no tiene instalado el módulo `stock`
  (opt-in) o tiene el ciclo de inventario apagado. Pintar un 0 ahí afirma
  «nada comprometido», que es justo lo que no se sabe.
- **Es GLOBAL por artículo, sin dimensión de almacén.** De los dos documentos
  que comprometen solo el albarán declara almacén, así que un reparto tendría
  la mitad resuelta al «por defecto» en el momento de leer — y se movería solo
  al cambiar ese por defecto.
- **Una factura borrador no compromete lo que su albarán ya entregó.** El
  servidor hace la misma resta que hará al publicarla; no la repitas tú.
- El libro (`stockMovements`) es **N1 y es de todos**: no va tras el módulo
  `stock`, a diferencia de `warehouses` y `stockCounts`.

## [0.15.0] — 2026-08-31

**El recuento de inventario.** Cuadrar el almacén con la realidad eran
cincuenta ajustes manuales y cincuenta motivos tecleados; ahora es un
documento que lo hace de una vez. Pieza 2 de la fase N2 del estudio de stock;
núcleo en galeote/factSaas#595.

Spec sincronizado con **factSaas@7721dcfb** (2026-08-31) — **415 operaciones**
(siete más). Ninguna retirada.

### Añadido

- **Recuentos** (7 operaciones): el CRUD (`GET|POST /stock-counts`,
  `GET|PUT|DELETE /stock-counts/{id}`, con el alta en **201**) y las dos
  acciones del ciclo, `confirm` y `cancel`.
- **`client.stockCounts`** en `@pimia/sdk` y **`$client->stockCounts`** en
  `pimia/pimia-php`: `list`/`get`/`create`/`update`/`confirm`/`cancel`/
  `delete`, con la misma forma en los dos.

### Lo que hay que tener delante para integrarlo

- **Contar y confirmar son llamadas distintas, a propósito.** `update` escribe
  lo contado y **no mueve una sola existencia**; `confirm` emite los ajustes en
  bloque, uno por línea con diferencia, todos con motivo `count` y en la misma
  transacción. Separarlos es lo que permite contar en tres ratos y revisar
  antes de tocar el almacén.
- ⛔ **La diferencia se calcula al CONFIRMAR**, contra el saldo de ese momento:
  un recuento dice «aquí hay 12», no «quítale 3». Si algo se movió entre contar
  y confirmar, el almacén queda igualmente en lo contado — y la respuesta lo
  dice en `meta.moved_while_counting`. **No programes contra una resta
  guardada**: el servidor no la garantiza, y el estado final sí.
- ⛔ **`counted_quantity: null` es «sin contar», y no es cero.** Las líneas en
  null no emiten nada al confirmar; mandar `0` es declarar que miraste y no
  había. Colapsar los dos convierte un recuento a medias en un vaciado del
  almacén — hay un test en cada SDK que fija que el `null` llega al cable tal
  cual.
- **Un recuento nace sembrado** con lo que el almacén dice tener (`seed`, por
  defecto sí): contar es corregir una lista, no escribirla de cero.
- **Confirmado es historia**: ni se edita, ni se cancela, ni se borra
  (`stock_count_not_draft`, `stock_count_confirmed`). Y confirmar sin haber
  contado nada es un `422 stock_count_empty`: no es cuadrar el almacén, es no
  haber contado.

### Sin cambios de scope

Los recuentos cuelgan de `items:*` y viven tras el módulo `stock`, como el
resto de N2. Nada que añadir a `SCOPES` ni a `Scopes`.

## [0.14.0] — 2026-08-31

**Los documentos dicen a qué almacén.** La 0.13.0 trajo la dimensión; con ella
se podían crear almacenes y **ninguno podía recibir nada**, porque ningún
documento tenía dónde declarar otra cosa que el por defecto. Lo destapó medir
la pantalla. Núcleo en galeote/factSaas#594.

Spec sincronizado con **factSaas@81180946** (2026-08-31) — **408 operaciones**,
las mismas: esto no añade rutas, añade un campo a tres cuerpos.

### Añadido

- **`warehouse_id` (opcional) en tres sitios**, los tres gestos cuyo
  significado ES mover mercancía:
  - `POST /items/{id}/stock-adjustments` — el ajuste, que es además el único
    gesto que declara existencias en un almacén concreto sin documento de por
    medio;
  - el albarán (`POST|PUT /delivery-notes…`), de dónde salen al entregar;
  - `POST /received-invoices/{id}/mark-goods-received` — **y aquí está el
    matiz que conviene leer**: el almacén se declara al RECIBIR y no al
    teclear la factura, porque es al descargar el camión cuando se sabe dónde
    va. Lo que se manda ahí manda sobre lo que declarase el documento, y el
    servidor lo escribe en él.
- **`warehouse_id` publicado** en `DeliveryNoteResource` y
  `ReceivedInvoiceResource`.

### Lo que hay que saber

- **Omitirlo no es mandarlo a `null`**: sin el campo, el servidor resuelve su
  almacén por defecto **en el momento de moverse**, no al guardar. Por eso
  cambiar el almacén por defecto de la empresa no reescribe la intención de un
  documento viejo.
- **Un id de otra empresa es un `422`**, no un id que se ignora en silencio.
- ⚠️ **Cambiar el almacén de un albarán ya entregado no mueve nada**: el
  asiento está escrito con el almacén de entonces y el libro no se reescribe.
  Lo que corrige un movimiento del almacén equivocado es un ajuste con motivo.

## [0.13.0] — 2026-08-31

**El almacén se vuelve una DIMENSIÓN.** Hasta aquí el inventario sabía CUÁNTO
(el contador de cada artículo) y, desde el libro de movimientos, QUIÉN lo
movió. No sabía **DÓNDE**: una pyme con tienda y nave no podía responder
«¿cuántos me quedan en la tienda?». Es la pieza 1 de la fase N2 del estudio de
stock, con sus seis decisiones ratificadas el 2026-08-31
(`pimia-web-shadcn/docs/ESTUDIO-STOCK.md` § 8); núcleo en galeote/factSaas#593.

Spec sincronizado con **factSaas@5dfc6991** (2026-08-31) — **408 operaciones**
(diez más que la 0.12.0: las seis de almacenes y las que trajo de camino el
cierre de S6-S8 del mismo estudio). Ninguna retirada.

### Añadido

- **Almacenes** (6 operaciones): el CRUD (`GET|POST /warehouses`,
  `GET|PUT|DELETE /warehouses/{id}`, con el alta en **201**) y las existencias
  de un almacén artículo a artículo (`GET /warehouses/{id}/stock`). Cuatro
  cosas que el contrato dice y conviene tener delante:
  - 🔴 **viven tras el módulo `stock`, que es OPT-IN**: un tenant que no lo ha
    instalado recibe `403` con `error: module_not_installed`, y eso **no es
    falta de scope** — es una capacidad que la pyme no ha pedido. El libro de
    movimientos, el ajuste con motivo y la mercancía recibida NO pasan por ahí
    y siguen siendo de todos;
  - **sin scope propio**: `items:read` / `items:write`, los mismos del
    catálogo que dimensionan. Quien ya puede reescribir el contador entero de
    un artículo no necesita otra llave para decir en qué nave está;
  - **exactamente uno lleva `is_default`** y hereda todo movimiento que no
    elige almacén. Mandarlo es declarar una intención: el servidor apaga el
    anterior en la misma transacción, y el único que hay no se puede apagar ni
    desactivar (`422 default_warehouse_required`);
  - **el borrado solo se lleva los vacíos y sin historia**
    (`stock_movements_attached`, `stock_attached`): un almacén con pasado
    explica saldos de hoy, y para el que ya no se usa está `is_active: false`.
- **`warehouse_id` y `warehouse_name` en `StockMovementResource`**, y
  `warehouse_id` como filtro del índice del libro: cada asiento dice dónde
  pasó. Los anteriores a la dimensión quedaron todos en el «Principal» que
  estrenó la migración — la única respuesta verdadera, porque nadie declaró
  jamás dónde estaban.
- **`meta.warehouse_stock`** en el libro de un artículo: el reparto de su
  contador entre almacenes. ⛔ **Su suma es exactamente `opening_stock`** — es
  el mismo número contado por sitios, no una segunda cuenta. Puede ser
  negativo en un almacén (se entregó desde donde no había): aplicar ahí el
  suelo en 0 cuadraría la fila y descuadraría la suma.
- **`client.warehouses`** en `@pimia/sdk` y **`$client->warehouses`** en
  `pimia/pimia-php`: `list`/`get`/`create`/`update`/`delete`/`stock`, con la
  misma forma en los dos — sin asimetrías esta vez. Con tests en los dos
  SDKs, incluido uno que fija que el **403 de módulo no instalado no se
  disfraza de falta de scope**: confundirlos manda a un integrador a pedir un
  permiso que ya tiene.

### Sin cambios de scope

Nada que añadir a `SCOPES` ni a `Scopes`: los almacenes cuelgan de `items:*`,
que ya estaban. Es la decisión N2-3 del estudio —la reapertura que S5 dejó
anunciada, resuelta en «no»—: un scope nuevo protegería una puerta que
`items:write` ya tiene abierta, y costaría catálogo, consentimiento,
superficie, SDK y **reconexión de todos los grants**.

## [0.12.0] — 2026-08-30

**Contratos: la primera funcionalidad que nace núcleo → spec → SDK, sin Vue
delante.** Un contrato de servicio GOBIERNA facturas recurrentes: su periodo
se vuelve los límites de la recurrente, y el ciclo de vida va por acciones —
el `PUT` no acepta `status`. Estudio ratificado el 2026-08-30
(`pimia-web-shadcn/docs/ESTUDIO-CONTRATOS.md`); núcleo en galeote/factSaas#585
y #586.

Spec sincronizado con **factSaas@f0655568** (2026-08-30) — **398 operaciones**
(catorce más que la 0.11.0) y **136 schemas** (seis más). Ninguna retirada.
Además del bloque de contratos, la 0.11.0→0.12.0 arrastra los retoques del
propio núcleo sobre esquemas existentes (`contract_id` nullable en la factura
y las cuatro abilities de contratos en su enum).

### Añadido

- **Contratos** (12 operaciones, dominio propio `contracts:read`/`write`, de
  partner con consentimiento): CRUD (índice, alta con **201**, ficha, edición,
  borrado individual y en lote), las tres acciones del ciclo de vida
  (`activate`/`cancel`/`renew`), el documento firmado (`POST`/`DELETE
  /contracts/{id}/document`, multiparte) y el enlace firmado del PDF
  (`shared-link`). Tres cosas que el contrato dice y conviene tener delante:
  - **activar exige `contracts:write` E `invoices:write`** (la recurrente que
    nace emitirá facturas por su cuenta) — publicado en el `security` de la
    operación, el segundo caso de doble scope tras `convert-to-invoice`;
  - **el número llega al activar**: `contract_number` es `null` en borrador;
  - los cerrados (`status`, `renewal_mode`, `billing_every`) van con **enum
    declarado** en el request — la opacidad de `frequency`/`limit_by` de la
    recurrente no se hereda.
- **`client.contracts`** en `@pimia/sdk` y **`$client->contracts`** en
  `pimia/pimia-php`: `list`/`get`/`create`/`update`/`activate` (con
  `recurringInvoiceId` para adoptar una recurrente existente)/`cancel`/
  `renew`/`sharedLink`; `uploadDocument` solo en TS — en PHP el multiparte va
  por ruta cruda hasta su helper (asimetría anotada, como manda la checklist).
  Tipos `ContractResource`/`ContractRequest` re-exportados.
- **`SCOPES.contractsRead`/`contractsWrite`** (TS) y
  **`Scopes::CONTRACTS_READ`/`CONTRACTS_WRITE`** (PHP), con el aviso del doble
  scope en el docblock del write.

## [0.11.0] — 2026-08-27

**Las tres aperturas del panel: delegación, asesoría y VeriFactu.** El día en
que el núcleo ejecutó «nada de lo que hace Vue se pierde en la web»
(DECISIONES § 10): tres superficies que eran opacas entran en el contrato,
todas de primera parte.

Spec sincronizado con **factSaas@0fbfcc92** (2026-08-27) — **384 operaciones**,
veinticuatro más que la 0.10.0. **Ninguna retirada, ningún cambio estructural
en las ya publicadas** (comprobado operación a operación, resolviendo `$ref`:
mismos `security`, cuerpos y respuestas; solo se mueve prosa, incluida la de
`connected-apps` que factSaas#533 tocó tras salir la 0.10.0). Ningún schema
nuevo ni retirado.

### Añadido

Las 24 operaciones van TODAS con `x-pimia-partner-availability:
first-party-only`: exigen scopes que el catálogo reserva al client del panel
web de Pimia. Entran en el documento porque sus tipos salen de aquí; **un
integrador no puede llamarlas.**

- **Delegación al agente** (factSaas#538, 16 operaciones, `delegation:*`): el
  catálogo de tareas delegables (`GET /delegable-tasks`, `discover`,
  `PUT`/`DELETE /delegable-tasks/{task_type}`, `reverify`), delegar y ejecutar
  (`POST /delegable-tasks/delegate`, `execute`), el ciclo de propuestas
  (`approve`/`reject`/`needs-changes`) y el lado del ejecutor
  (`GET /delegated-tasks`, `claim`/`complete`/`fail`/`propose`).
- **El vínculo con la asesoría** (factSaas#539, 4 operaciones, `admin:*`):
  `GET /gestoria-link/asesorias` (directorio de despachos, NIF enmascarado),
  `GET /gestoria-link/status`, y `POST /request` / `DELETE /revoke`, que crean
  y rompen el vínculo entre la pyme y su gestoría.
- **La configuración de VeriFactu** (factSaas#543, 4 operaciones, scope nuevo
  `verifactu:*`): `GET`/`PUT /settings/verifactu` (entorno AEAT y
  representante), `POST /settings/verifactu/taxpayer` (alta idempotente del
  contribuyente) y `POST /settings/verifactu/certificate` (el certificado de
  firma, `multipart/form-data`). El núcleo condicionó la apertura a dos
  arreglos que ya van dentro: permiso de usuario en las cuatro rutas y un PUT
  que contesta **502** cuando la API de VeriFactu falla, en vez del 200
  «guardado localmente» de antes.

### Cambiado

- El flow `oauth2` del spec publica **`verifactu:read` y `verifactu:write`**,
  con el prefijo «(solo el panel de Pimia)»: son `first_party_only`, como
  `admin:*` y `delegation:*`. `SCOPES`/`Scopes` **no cambian** — no hay nada
  nuevo que un integrador pueda pedir — y el guardarraíl
  (`typescript/test/scopes.test.js`) suma los dos a la lista explícita de
  reservados, que es donde se decide de qué lado cae cada scope nuevo.

## [0.10.0] — 2026-08-26

**«Apps conectadas» entra en el contrato y `PUT /me` deja de ser operación de
dueño.** El grueso es que el spec vuelve a estar al día: la 0.9.0 se tageó el
25 y el núcleo siguió moviéndose ese mismo día y el siguiente.

Spec sincronizado con **factSaas@b998c351** (2026-08-26) — **360 operaciones**,
tres más que la 0.9.0. **Ninguna retirada, ningún schema tocado.**

### Añadido

- **Las tres operaciones de «Apps conectadas»**, marcadas
  `x-pimia-partner-availability: first-party-only`: exigen `admin`, que el
  catálogo reserva al client del panel web de Pimia. Entran en el documento
  porque la web tiene que sustituir al panel Vue de la pyme y sus tipos salen
  de aquí; **un integrador no puede llamarlas**.

  | operación | qué hace |
  |---|---|
  | `GET /settings/connected-apps` | las apps que el usuario ha autorizado |
  | `DELETE /settings/connected-apps/{authorizationId}` | retira el acceso de una app entera |
  | `DELETE /settings/connected-apps/credentials/{credentialId}` | cierra UNA credencial |

  Lo nuevo del núcleo es `credentials[]`: un grant OAuth es único por
  `(client_id, tenant_id, user_id)`, así que autorizar la misma app desde el
  móvil y desde el portátil **suma credenciales a la misma fila** en vez de
  sustituirlas. Cada una trae desde cuándo está conectada —la ceremonia, no la
  última rotación del refresh—, su último uso real y cuándo caduca, y se puede
  cerrar sola.

  ⚠️ **Si tu app guarda el refresh en varios sitios, esto se nota aunque no
  llames a estas rutas.** Una credencial cerrada devuelve `invalid_grant` en el
  siguiente refresco mientras las otras siguen vivas; antes o caían todas o no
  caía ninguna. La reacción correcta es la de siempre: volver a pedir
  autorización **desde ese dispositivo**, no desde todos. Y cerrar una
  credencial **no emite `app.revoked`** — ese aviso sigue significando que te
  han retirado el acceso entero.

- **Cuatro scopes que el catálogo emite a partners y `SCOPES` no ofrecía**:
  `settings:write`, `reports:write`, `store:write` y `ocr:write`. En los dos
  SDKs (`SCOPES` en TypeScript, `Scopes` en PHP).

  No es cosmético: `settings:write` es **justo el que `PUT /me` exige** desde
  que dejó de ser operación de dueño (ver abajo), así que sin él la novedad de
  esta versión no se podía usar. Los otros tres llevaban desde el 2026-08-22 en
  el catálogo del Authorization Server sin llegar aquí.

- **Guardarraíl contra esa misma deriva** (`typescript/test/scopes.test.js`):
  compara `SCOPES` con el flow del spec commiteado y se pone rojo si el
  catálogo gana un scope que nadie ha clasificado. La 0.6.0 ya tuvo que añadir
  cinco que faltaban y esta otros cuatro; hasta ahora nada avisaba y se
  descubría al necesitarlo.

### Cambiado

- 🔴 **`PUT /me` deja de ser `owner-only` y pasa a ser contrato de partner**,
  declarando `settings:write`. Antes exigía además `admin:write` —reservado a
  la primera parte— y un token de integrador recibía `403`.

  ⚠️ **Va con una condición nueva del núcleo**: cambiar el correo o la
  contraseña exige `current_password`, la vigente del usuario. El contrato la
  publica —`ProfileRequest.current_password`, con la condición escrita en la
  descripción del schema— pero **como campo opcional**, porque es obligatoria
  solo en ese caso y un tipo estático no expresa un condicional. Es decir: que
  `tsc` te deje omitirla no significa que el servidor te la deje omitir. En la
  práctica: el **nombre** lo cambias sin más; el correo y la contraseña, solo
  si la persona te facilita la suya en ese momento.

- **`POST /tasks/{task}/delegate`** pasa de `owner-only` a `first-party-only` y
  declara `crm:write` + `delegation:write`. No es una apertura: `delegation` lo
  reserva la primera parte. Lo que cambia es que el documento ya no dice «exige
  un scope que nadie emite», que era falso desde el 2026-08-22.

- **`GET /app/version`** tipa `version` como `string | null`. Antes era un
  `anyOf` de cuatro ramas (`null | array | string | object`) que el generador
  producía por no saber qué devolvía; si tu código ramificaba sobre esas ramas,
  el tipo se estrecha.

- **Prosa: «céntimos» → «subunidades»** en las descripciones de los tres
  índices con `view=summary`, la banca y el resumen contable. La moneda la
  declara cada instancia y no siempre es el euro; el dato no cambia.

### Quitado

Nada.

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
