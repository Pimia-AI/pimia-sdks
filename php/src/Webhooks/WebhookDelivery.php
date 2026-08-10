<?php

declare(strict_types=1);

namespace Pimia\Webhooks;

/**
 * Una entrega ya verificada: firma buena, dentro de la ventana y con el cuerpo
 * parseado.
 *
 * Los payloads van documentados como *array shapes* —no como DTOs— por
 * coherencia con el resto de este SDK, que devuelve la respuesta de la API tal
 * cual. PHPStan y Psalm los entienden; tu IDE, en su mayoría, también.
 *
 * Las marcas de tiempo son ISO-8601 **con offset** (`2026-08-10T12:34:56+02:00`),
 * nunca `Z` puro. Los importes van en **céntimos**.
 *
 * `external_ref` es la referencia externa **de quien recibe esta entrega**: la
 * que TU app puso sobre el recurso, nunca la de otro integrador. No se calcula
 * una vez y se reparte — el core la resuelve endpoint por endpoint contra el
 * `client_id` del destinatario, porque un mismo evento se entrega a todos los
 * endpoints suscritos de la company y esos pueden ser de integradores distintos.
 * Una referencia escrita sin client OAuth (panel, token personal) no sale nunca
 * por este canal. La clave viaja **siempre**, con `null` cuando no hay
 * referencia: un payload cuya forma cambia según el dato no se puede tipar. Solo
 * la llevan los cinco eventos de recurso; `approval.decided`, `invoice.received`
 * y `app.revoked` no van sobre un recurso etiquetable y no la incluyen.
 *
 * @phpstan-type ApprovalDecidedPayload array{
 *     plane: string,
 *     delegation_ref: string,
 *     outcome: string,
 *     task_type: string|null,
 *     autonomous: bool,
 *     sello: string|null,
 *     verification_level: int|null,
 *     tenant: string|null,
 *     verified_at: string|null,
 * }
 * @phpstan-type InvoiceReceivedPayload array{
 *     id: int|string,
 *     number: string|null,
 *     sequence_number: int|string|null,
 *     supplier: array{id: int|string|null, name: string|null},
 *     total: int,
 *     currency_id: int|string|null,
 *     created_at: string|null,
 * }
 * @phpstan-type AppRevokedPayload array{
 *     client_id: string,
 *     tenant_id: string|null,
 *     user_id: int|string,
 *     reason: string,
 *     revoked_tokens: int,
 * }
 * @phpstan-type CustomerPayload array{
 *     id: int,
 *     name: string,
 *     company_id: int,
 *     created_at: string|null,
 *     updated_at: string|null,
 *     external_ref: string|null,
 * }
 * @phpstan-type InvoiceCreatedPayload array{
 *     id: int,
 *     number: string|null,
 *     sequence_number: int|null,
 *     status: string,
 *     paid_status: string,
 *     is_credit_note: bool,
 *     customer_id: int|null,
 *     company_id: int,
 *     sub_total: int,
 *     tax: int,
 *     total: int,
 *     due_amount: int,
 *     currency_id: int|null,
 *     created_at: string|null,
 *     external_ref: string|null,
 * }
 * @phpstan-type EstimateAcceptedPayload array{
 *     id: int,
 *     number: string|null,
 *     sequence_number: int|null,
 *     status: string,
 *     customer_id: int|null,
 *     lead_id: int|null,
 *     company_id: int,
 *     sub_total: int,
 *     tax: int,
 *     total: int,
 *     currency_id: int|null,
 *     accepted_at: string|null,
 *     external_ref: string|null,
 * }
 * @phpstan-type InvoicePaidPayload array{
 *     id: int,
 *     number: string|null,
 *     status: string,
 *     paid_status: string,
 *     is_credit_note: bool,
 *     customer_id: int|null,
 *     company_id: int,
 *     total: int,
 *     due_amount: int,
 *     currency_id: int|null,
 *     paid_at: string|null,
 *     external_ref: string|null,
 * }
 */
final class WebhookDelivery
{
    /**
     * @param  WebhookEvent|null  $event  `null` cuando el catálogo del servidor
     *                                    es más nuevo que este SDK. La firma se
     *                                    verificó igual: no lo trates como un
     *                                    error, ignóralo o encólalo.
     * @param  string  $eventName  El nombre crudo de la cabecera
     *                             `X-Pimia-Event`, conocido o no.
     * @param  string  $delivery  Id de la entrega (`X-Pimia-Delivery`). **Tu
     *                            clave de idempotencia como receptor**: un
     *                            reintento de Pimia trae el mismo id, así que
     *                            procesar cada uno una sola vez es todo lo que
     *                            hace falta para el exactly-once.
     * @param  int  $timestamp  Epoch en segundos, ya validado contra la ventana.
     * @param  ApprovalDecidedPayload|InvoiceReceivedPayload|AppRevokedPayload|CustomerPayload|InvoiceCreatedPayload|EstimateAcceptedPayload|InvoicePaidPayload|array<string, mixed>  $payload
     */
    public function __construct(
        public readonly ?WebhookEvent $event,
        public readonly string $eventName,
        public readonly string $delivery,
        public readonly int $timestamp,
        public readonly array $payload,
    ) {
    }

    /** `false` si el evento no está en el catálogo que conoce este SDK. */
    public function isKnown(): bool
    {
        return $this->event !== null;
    }

    public function is(WebhookEvent $event): bool
    {
        return $this->event === $event;
    }
}
