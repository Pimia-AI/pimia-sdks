<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/**
 * Facturación emitida. Exige los scopes `invoices:read` / `invoices:write`.
 *
 * Recuerda las invariantes del core: una factura emitida NO se borra (se
 * rectifica), y con VeriFactu activo lo enviado a la AEAT es inmutable. La API
 * las aplica del lado del servidor: no hay forma de saltárselas desde aquí.
 */
final class Invoices
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /** @param array<string, mixed> $query */
    public function list(array $query = []): mixed
    {
        return $this->client->get('/invoices', $query);
    }

    public function get(int|string $id): mixed
    {
        return $this->client->get("/invoices/{$id}");
    }

    /** @param array<string, mixed> $data */
    public function create(array $data): mixed
    {
        return $this->client->post('/invoices', $data);
    }

    /** @param array<string, mixed> $data */
    public function update(int|string $id, array $data): mixed
    {
        return $this->client->put("/invoices/{$id}", $data);
    }
}
