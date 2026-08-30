<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/**
 * Contratos de servicio. Exige `contracts:read` / `contracts:write`.
 *
 * Un contrato GOBIERNA facturas recurrentes: su periodo se vuelve los límites
 * de la recurrente. El ciclo de vida va por acciones —no hay `status` en el
 * PUT—, y dos cosas que el spec cuenta pero conviene tener delante:
 *
 *  - **activar exige además `invoices:write`**: la recurrente que nace (o se
 *    adopta) emitirá facturas por su cuenta;
 *  - **el número llega al activar** (`contract_number` es `null` en
 *    borrador): un borrador no gasta numeración, como la factura que nace de
 *    convertir un presupuesto.
 */
final class Contracts
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /** @param array<string, mixed> $query */
    public function list(array $query = []): mixed
    {
        return $this->client->get('/contracts', $query);
    }

    public function get(int|string $id): mixed
    {
        return $this->client->get("/contracts/{$id}");
    }

    /** @param array<string, mixed> $data */
    public function create(array $data, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post('/contracts', $data, $idempotencyKey);
    }

    /** @param array<string, mixed> $data */
    public function update(int|string $id, array $data): mixed
    {
        return $this->client->put("/contracts/{$id}", $data);
    }

    /**
     * Activa el contrato: DRAFT → ACTIVE, numera, y crea la recurrente
     * gobernada — o adopta la existente si pasas `$recurringInvoiceId` (misma
     * empresa y mismo cliente; sus líneas e impuestos no se tocan).
     *
     * Exige `contracts:write` **e** `invoices:write`. Pasa `$idempotencyKey`
     * —una clave estable por contrato, del estilo `contract:{id}:activate`—
     * y el reintento tras un timeout no te creará una segunda recurrente.
     */
    public function activate(
        int|string $id,
        int|string|null $recurringInvoiceId = null,
        ?string $idempotencyKey = null,
    ): mixed {
        $body = $recurringInvoiceId === null ? [] : ['recurring_invoice_id' => $recurringInvoiceId];

        return $this->client->post("/contracts/{$id}/activate", $body, $idempotencyKey);
    }

    /**
     * Cancela el contrato: sus recurrentes quedan en pausa (`ON_HOLD`) y las
     * facturas ya emitidas conservan su rastro entero.
     */
    public function cancel(int|string $id, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post("/contracts/{$id}/cancel", [], $idempotencyKey);
    }

    /**
     * Renovación manual: extiende `ends_at` (tiene que ser posterior al fin
     * actual) y lo propaga a las recurrentes gobernadas, reviviendo las que
     * llegaron a `COMPLETED` por el límite viejo.
     */
    public function renew(int|string $id, string $endsAt, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post("/contracts/{$id}/renew", ['ends_at' => $endsAt], $idempotencyKey);
    }

    /**
     * El enlace del PDF para el cliente final: una URL FIRMADA con caducidad
     * (7 días por defecto). Un contrato en borrador —sin número— es un 422.
     */
    public function sharedLink(int|string $id): mixed
    {
        return $this->client->get("/contracts/{$id}/shared-link");
    }
}
