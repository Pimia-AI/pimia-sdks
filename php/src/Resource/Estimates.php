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
}
