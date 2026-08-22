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

## Cómo leer los tipos: los `string` que son números

El spec describe lo que la API **devuelve de verdad**, y la API es
inconsistente con los números. Dos cosas que hay que saber antes de escribir
código contra `api.d.ts`:

**Los importes monetarios tipados `string` son decimales con dos cifras.**
En la 0.6.0 hay 89 propiedades monetarias así (`amount`, `due_amount`,
`total`, `sub_total`, `tax`, `*_price`… según el recurso). No son céntimos, no
son notación científica y no llevan separador de miles ni símbolo de moneda:
son la representación decimal de una columna `decimal(15, 2)` de Postgres, tal
cual la entrega PDO — `"1234.56"`, `"0.00"`, y `"-99.90"` cuando el signo
tiene sentido. Conviértelos tú (`Number(v)` en TS; en PHP, mejor
`bcadd`/`bcmul` o un tipo decimal antes que `floatval`, si vas a sumar).

**No es un fallo del generador ni una decisión de diseño: falta un cast en el
núcleo.** Solo `InvoiceResource`, `EstimateResource` y `ReceivedInvoiceResource`
castean sus `total`/`sub_total`/`tax` a entero, y ni ellos castean
`due_amount`. El resto de Resources no castea nada. Lo mismo pasa con 124
propiedades `id`/`*_id`, que llegan como cadena en 31 Resources.

**Esto es deuda del contrato, no la forma definitiva.** Está abierto como
issue en este repo y en el núcleo: cuando los Resources declaren sus casts, el
spec pasará a tipar `number` y será un cambio incompatible anunciado en el
CHANGELOG. Hasta entonces, no asumas el tipo por el nombre del campo: **mira
`api.d.ts`**, que dice el que hay hoy.

## Operaciones con el `200` sin describir

25 operaciones declaran un `200` vacío (`{"type": "object"}`) — entre ellas
`POST /invoices`, `PUT /invoices/{invoice}`, `PUT /customers/{customer}` y
`POST /estimates/{estimate}/convert-to-invoice`. El cuerpo llega igual; lo que
falta es la descripción, y por eso el tipo generado no te ayuda ahí. Causa: un
`@return JsonResponse` heredado de InvoiceShelf que gana a la inferencia, más
la función global `respondJson()` que Scramble no resuelve. También está
abierto como issue.
