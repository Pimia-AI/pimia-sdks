<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/**
 * El libro del almacén: por qué un artículo tiene el saldo que tiene.
 *
 * Exige `items:read` — leer el libro es leer el catálogo que explica— y, a
 * diferencia de almacenes y recuentos, **NO va tras el módulo `stock`**: el
 * libro es N1 y N1 es de todos. Un asiento por cada cambio del contador, con
 * su motivo (`sale_invoice`, `delivery_note`, `purchase`, `manual_adjustment`,
 * `count`, `pos_sale`…), su documento de origen y el saldo resultante.
 *
 * ## El COMPROMETIDO, en la cabecera de `forItem`
 *
 * `meta.committed` responde la otra mitad de la pregunta: no «cuánto tengo»
 * sino **«cuánto de lo que tengo puedo vender»**. Trae la cantidad, el
 * disponible (saldo − comprometido) y el DESGLOSE de los documentos que lo
 * comprometen.
 *
 * Tres cosas que hay que tener delante para no programar contra una aritmética
 * que el servidor no garantiza:
 *
 *  1. **Es una cifra DERIVADA**: no hay columna que escribir, no existe un
 *     `PUT` para reservar. Comprometen el albarán y la factura **en borrador**,
 *     y dejan de hacerlo solos cuando mueven el almacén (al entregar y al
 *     publicar). El presupuesto aceptado NO compromete: nada en el núcleo dice
 *     cuándo se cumplió.
 *  2. ⚠️ **`committed` a `null` NO es cero.** Es «no se está calculando» — la
 *     empresa no tiene el módulo `stock` instalado, o tiene el ciclo de
 *     inventario apagado. Pintar un 0 ahí afirma «nada comprometido», que es
 *     justo lo que no se sabe. Lo mismo vale para `committed_quantity` en el
 *     artículo.
 *  3. **Es GLOBAL por artículo, sin dimensión de almacén.** De los documentos
 *     que comprometen solo el albarán declara almacén, así que un reparto
 *     tendría la mitad inventada.
 */
final class StockMovements
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /**
     * El libro entero de la empresa, filtrable por artículo, almacén, motivo y
     * fechas. Su `meta` trae además el valor informativo del almacén
     * (`stock_value_cents`) — que NO es valoración contable.
     *
     * @param  array<string, mixed>  $query
     */
    public function list(array $query = []): mixed
    {
        return $this->client->get('/stock-movements', $query);
    }

    /**
     * El libro de UN artículo, con la cabecera que lo explica: saldo
     * (`meta.opening_stock`), reparto por almacén (`meta.warehouse_stock`) y
     * comprometido (`meta.committed`).
     *
     * @param  array<string, mixed>  $query
     */
    public function forItem(int|string $itemId, array $query = []): mixed
    {
        return $this->client->get("/items/{$itemId}/stock-movements", $query);
    }

    /**
     * El ajuste manual con motivo: la corrección que deja rastro, frente al
     * `PUT /items/{item}` que pisa el contador sin decir por qué. Cantidad
     * FIRMADA (± decimal) y `note` obligatoria; `warehouse_id` opcional
     * (sin él, el almacén por defecto).
     *
     * @param  array<string, mixed>  $data
     */
    public function adjust(int|string $itemId, array $data, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post("/items/{$itemId}/stock-adjustments", $data, $idempotencyKey);
    }
}
