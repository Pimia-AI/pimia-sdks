<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/** Clientes. Exige `customers:read` / `customers:write`. */
final class Customers
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /** @param array<string, mixed> $query */
    public function list(array $query = []): mixed
    {
        return $this->client->get('/customers', $query);
    }

    public function get(int|string $id): mixed
    {
        return $this->client->get("/customers/{$id}");
    }

    /** @param array<string, mixed> $data */
    public function create(array $data, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post('/customers', $data, $idempotencyKey);
    }

    /** @param array<string, mixed> $data */
    public function update(int|string $id, array $data): mixed
    {
        return $this->client->put("/customers/{$id}", $data);
    }
}
