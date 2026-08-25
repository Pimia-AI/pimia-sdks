# Contrato (OpenAPI)

`pimia-api-v1.json` es una **copia** del artefacto que genera el core de Pimia
(`docs/openapi/pimia-api-v1.json` en factSaas, exportado con
`php artisan scramble:export`). Se versiona aquí para que los SDKs tengan un
contrato reproducible sin depender del core.

No lo edites a mano: refréscalo con `../scripts/sync-spec.sh <checkout-del-core>`.
El script hace `git fetch` y lee el artefacto de `origin/main` del núcleo (no
del working tree del checkout, que suele estar en otra rama) y **aborta si el
spec nuevo tiene menos operaciones** que el que ya está aquí.

Superficie: los dominios de negocio públicos (facturación, presupuestos,
clientes, gastos, pagos, artículos, banca, CRM, agenda, informes) más los
catálogos `meta`. Administración, configuración e internos quedan fuera a
propósito.

## Cómo leer los tipos: el dinero y los identificadores

**Desde la 0.8.0 el dinero de facturación es un entero en céntimos**, y los
`id` son números. En la 0.7.0 no lo eran: 172 propiedades viajaban como texto
porque a los Resources del núcleo les faltaban los casts, y el spec describía
—correctamente— lo que la API devolvía. Ahora los declara, y el contrato lo
publica. Si vienes de la 0.7.0, la nota de migración está en el CHANGELOG.

Lo que hay que saber hoy son las **excepciones**, que son pocas y concretas:

**La banca cuenta en euros, no en céntimos.** `BankAccount.opening_balance`,
`BankAccount.balance` y `BankTransaction.amount` siguen tipados `string` y son
decimales con dos cifras — `"1234.56"`, `"0.00"`, `"-99.90"` cuando el signo
tiene sentido: la representación de una columna `decimal(15,2)` tal cual la
entrega PDO. No es un descuido: es el criterio del módulo de banca, y por eso
las tres llevan la unidad escrita en su `description`. Es el sitio exacto
donde el MCP ya se equivocó una vez, así que **no apliques al extracto
bancario el `/100` que necesita una factura**.

**Quedan nueve importes de facturación sin castear**, y todos son derivados:
los seis `effective_*` y `credited_*` de `InvoiceResource`, los dos
`effective_*` de `InvoiceSummaryResource` y `RecurringInvoiceResource.discount`.
Y una trampa con nombre engañoso:
**`TimeEntryResource.amount_cents` se declara `string`** pese a llamarse
`cents`. Todos son decimales, como los de banca.

**22 claves `*_id` siguen siendo cadena**, pero **ninguna es ya el `id` de un
recurso**: los 21 `*Resource` que devolvían su propio `id` como texto se
arreglaron. Las que quedan son ajenas (`country_id`, `sepa_mandate_id`) o
identificadores fiscales de verdad (`vat_id`), más `currency_id`, que en el
núcleo es `string` en 8 schemas e `integer` en 13 y tiene su issue abierta.

**Y algunas banderas siguen sin ser booleanas**: `tax_included`,
`tax_per_item`, `discount_per_item` y `discount_type` se declaran `string`,
sin enum, y lo que viaja son los `"YES"`/`"NO"` que mide la
[#26](https://github.com/Pimia-AI/pimia-sdks/issues/26). Nueve banderas sí
pasaron a `boolean` en la 0.8.0 (`is_default`, `is_active`, `is_system`,
`aeat_registered`…); estas no.

La regla, en una línea: **no asumas el tipo por el nombre del campo — mira
`api.d.ts`**, que dice el que hay hoy.

## Operaciones con el `200` sin describir

**Ninguna, desde la 0.8.0.** Eran 18 —entre ellas `POST /invoices`,
`PUT /invoices/{invoice}`, `PUT /customers/{customer}` y
`POST /estimates/{estimate}/convert-to-invoice`, o sea casi todas las
escrituras que un integrador hace de verdad—, y describían su `200` como un
`object` sin una sola propiedad: el cuerpo llegaba, pero el tipo generado no
ayudaba. Se cerraron también los dos casos que declaraban `string` y devuelven
JSON, `GET /me/settings` y `GET /legal-reports/pdf`.

Las descargas de verdad (CSV, PDF, XML, adjuntos) declaran su media type y
salen tipadas como `Blob`; para leerlas usa `client.download()`, no `get()`.
