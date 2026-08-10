<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/** Presupuestos. Exige `estimates:read` / `estimates:write`. */
final class Estimates
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /** @param array<string, mixed> $query */
    public function list(array $query = []): mixed
    {
        return $this->client->get('/estimates', $query);
    }

    public function get(int|string $id): mixed
    {
        return $this->client->get("/estimates/{$id}");
    }

    /** @param array<string, mixed> $data */
    public function create(array $data, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post('/estimates', $data, $idempotencyKey);
    }

    /**
     * Convierte un presupuesto aceptado en factura.
     *
     * El helper existe porque es el cierre natural del bucle
     * `estimate.accepted` → facturar, y sin él hay que ir por ruta cruda y
     * adivinar la forma de la respuesta.
     *
     * Dos cosas que conviene saber y que el spec no dice:
     *
     *  - **la factura nace BORRADOR y sin numerar**: `data.invoice_number` es
     *    `null` hasta que la publiques cambiando su estado. No es un fallo;
     *  - el id de la factura nueva está en `data.id`.
     *
     * Pasa `$idempotencyKey` —una clave estable por presupuesto, del estilo
     * `estimate:{id}:invoice`— y el reintento tras un timeout no te creará una
     * segunda factura.
     *
     * @return mixed `array{data: array<string, mixed>}` con la factura creada.
     *               Exige `estimates:write` **e** `invoices:write`.
     */
    public function convertToInvoice(int|string $id, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post("/estimates/{$id}/convert-to-invoice", [], $idempotencyKey);
    }
}
