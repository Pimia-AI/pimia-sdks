# Contrato (OpenAPI)

`pimia-api-v1.json` es una **copia** del artefacto que genera el core de Pimia
(`docs/openapi/pimia-api-v1.json` en factSaas, exportado con
`php artisan scramble:export`). Se versiona aquí para que los SDKs tengan un
contrato reproducible sin depender del core.

No lo edites a mano: refréscalo con `../scripts/sync-spec.sh <checkout-del-core>`.

Superficie: los dominios de negocio públicos (facturación, presupuestos,
clientes, gastos, pagos, artículos, banca, CRM, agenda, informes) más los
catálogos `meta`. Administración, configuración e internos quedan fuera a
propósito.
