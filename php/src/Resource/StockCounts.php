<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/**
 * Recuentos de inventario: contar un almacén y cuadrarlo de una vez. Exige
 * `items:read` / `items:write` y el módulo `stock` (opt-in), como el resto de
 * N2 — sin él, `403 module_not_installed`, que no es falta de scope.
 *
 * El ciclo es **contar → mirar diferencias → confirmar**, y los dos últimos
 * pasos son llamadas distintas a propósito: `update` escribe lo contado y **no
 * mueve una sola existencia**; `confirm` emite los ajustes en bloque, uno por
 * línea con diferencia, todos con motivo `count` y en la misma transacción.
 *
 * ⛔ Dos cosas que hay que tener delante para no programar contra una
 * aritmética que el servidor no garantiza:
 *
 *  1. **La diferencia se calcula al CONFIRMAR**, contra el saldo de ese
 *     momento: un recuento dice «aquí hay 12», no «quítale 3». Si algo se
 *     movió entre contar y confirmar, el almacén queda igualmente en lo
 *     contado, y el `meta.moved_while_counting` de la respuesta dice cuántas
 *     líneas fueron.
 *  2. **`counted_quantity` a `null` es «sin contar», y no es cero.** Las
 *     líneas en null no emiten nada; mandar 0 es declarar que miraste y no
 *     había.
 */
final class StockCounts
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /** @param array<string, mixed> $query */
    public function list(array $query = []): mixed
    {
        return $this->client->get('/stock-counts', $query);
    }

    public function get(int|string $id): mixed
    {
        return $this->client->get("/stock-counts/{$id}");
    }

    /**
     * Abre el recuento. Nace SEMBRADO con lo que el almacén dice tener
     * (`seed`, por defecto sí): contar es corregir una lista, no escribirla.
     *
     * @param  array<string, mixed>  $data
     */
    public function create(array $data, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post('/stock-counts', $data, $idempotencyKey);
    }

    /**
     * Cuenta: escribe lo contado. NO mueve el almacén.
     *
     * @param  array<string, mixed>  $data
     */
    public function update(int|string $id, array $data): mixed
    {
        return $this->client->put("/stock-counts/{$id}", $data);
    }

    /**
     * Confirma: emite los ajustes en bloque. La respuesta trae el resumen en
     * `meta` — ajustadas, cuadradas, sin contar, y las que se movieron
     * mientras se contaba.
     */
    public function confirm(int|string $id, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post("/stock-counts/{$id}/confirm", [], $idempotencyKey);
    }

    /** Cancela un borrador. Uno confirmado ya movió el almacén: 422. */
    public function cancel(int|string $id, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post("/stock-counts/{$id}/cancel", [], $idempotencyKey);
    }

    /**
     * Borra un recuento que no ha movido nada. Uno confirmado no se borra: sus
     * asientos explican el saldo de hoy.
     */
    public function delete(int|string $id): mixed
    {
        return $this->client->delete("/stock-counts/{$id}");
    }
}
