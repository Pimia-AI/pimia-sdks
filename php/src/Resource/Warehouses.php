<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/**
 * Almacenes: la DIMENSIÓN del stock. Exige `items:read` / `items:write`.
 *
 * El almacén cuelga del catálogo que dimensiona y **no estrena scope propio**:
 * quien ya puede reescribir el contador de un artículo con `items:write` no
 * necesita otra llave para decir en qué nave está.
 *
 * ⚠️ **Vive tras el módulo `stock`, que es opt-in.** Si la empresa no lo ha
 * instalado, estas rutas responden `403` con `error: module_not_installed`, y
 * eso NO es un problema de permisos ni de scope: es que la pyme no ha pedido
 * la capacidad. El libro de movimientos, el ajuste con motivo y la mercancía
 * recibida son de todos y no pasan por aquí.
 *
 * Dos verdades del servidor que conviene tener delante:
 *
 *  - **Exactamente un almacén lleva `is_default`**, y es el que hereda todo
 *    movimiento que no elige otro. Mandar `is_default` es declarar una
 *    intención: el servidor apaga el anterior en la misma transacción. No se
 *    puede apagar el único que hay (`422 default_warehouse_required`).
 *  - **El saldo por almacén es el REPARTO del contador global**, no una
 *    segunda cuenta: su suma por artículo es exactamente `opening_stock`. Por
 *    eso puede ser negativo — se entregó desde un almacén que no lo tenía.
 */
final class Warehouses
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /** @param array<string, mixed> $query */
    public function list(array $query = []): mixed
    {
        return $this->client->get('/warehouses', $query);
    }

    public function get(int|string $id): mixed
    {
        return $this->client->get("/warehouses/{$id}");
    }

    /** @param array<string, mixed> $data */
    public function create(array $data, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post('/warehouses', $data, $idempotencyKey);
    }

    /** @param array<string, mixed> $data */
    public function update(int|string $id, array $data): mixed
    {
        return $this->client->put("/warehouses/{$id}", $data);
    }

    /**
     * Borra un almacén VACÍO y sin historia.
     *
     * Tres negativas, cada una con su código: `default_warehouse_required`,
     * `stock_movements_attached` (su pasado explica saldos de hoy) y
     * `stock_attached`. Para el que ya no se usa, `update` con
     * `['is_active' => false]`.
     */
    public function delete(int|string $id): mixed
    {
        return $this->client->delete("/warehouses/{$id}");
    }

    /**
     * Las existencias de UN almacén, artículo a artículo — la pregunta que la
     * dimensión vino a contestar. `only_with_stock` deja fuera los ceros.
     *
     * @param  array<string, mixed>  $query
     */
    public function stock(int|string $id, array $query = []): mixed
    {
        return $this->client->get("/warehouses/{$id}/stock", $query);
    }
}
