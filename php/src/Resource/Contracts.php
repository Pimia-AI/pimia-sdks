<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/**
 * Contratos de servicio. Exige `contracts:read` / `contracts:write`.
 *
 * El ciclo de vida va por acciones —no hay `status` en el PUT—, y dos cosas
 * que el spec cuenta pero conviene tener delante:
 *
 *  - **activar exige además `invoices:write`**: la recurrente que nace (o se
 *    adopta) emitirá facturas por su cuenta;
 *  - **el número llega al activar** (`contract_number` es `null` en
 *    borrador): un borrador no gasta numeración, como la factura que nace de
 *    convertir un presupuesto.
 *
 * ── El MODO manda sobre el resto de la ficha (núcleo #933) ─────────────────
 *
 * Desde la decisión 11 hay cuatro modos y no todos facturan:
 *
 *  - `INSTALLMENTS`: `amount` (la CUOTA, en céntimos) y `billing_every`
 *    obligatorios. Es el ÚNICO que crea o adopta recurrente al activar.
 *  - `MILESTONES`: `total_amount` opcional e hitos ordenados.
 *  - `ONE_OFF`: `total_amount` opcional, sin periodicidad.
 *  - `NONE`: documento sin facturación.
 *
 * Un campo ajeno al modo es un 422, no un dato que se ignore; `customer_id`
 * sigue siendo obligatorio en los cuatro. Un alta que no declara
 * `billing_mode` se resuelve al persistido o a `INSTALLMENTS`: los contratos
 * anteriores al #933 son de cuotas y siguen comportándose igual.
 *
 * ⛔ Los hitos son GUÍA: no emiten factura ni marcan cobro, y `planned_date`
 * no es un vencimiento. La factura de un hito se crea a mano con
 * `contract_id` (`$client->invoices->create([... 'contract_id' => 7])`) y
 * aparece bajo el contrato. En los tres modos que no son de cuotas,
 * `recurring_invoices` llega `[]`, que es «ninguna» y no «no te lo cuento».
 */
final class Contracts
{
    /**
     * El catálogo de clausulados de la empresa: `$client->contracts->models`.
     *
     * Vive aparte porque sus permisos son otros: poder enviar un contrato no
     * concede redactar el papel de todos los demás.
     */
    public readonly ContractModels $models;

    public function __construct(private readonly PimiaClient $client)
    {
        $this->models = new ContractModels($client);
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
     * Envía a firmar con `contracts:write`. Solo esta respuesta trae
     * `signingUrl`: es una capacidad para firmar, no un campo para guardar
     * en logs ni exponer en listados. Completar la firma no activa el contrato.
     *
     * Desde el núcleo #934 acepta `document_version_id`: la `reference` de la
     * revisión que se acaba de revisar en {@see documentPreview()}. Es
     * `nullable` en la validación y **obligatoria bajo el bloqueo cuando el
     * contrato usa un modelo de clausulado** —la regla la decide el estado de
     * la fila, no la forma del cuerpo—, así que un contrato sin modelo se
     * sigue enviando sin ella. Una referencia inválida nunca cae a ese camino
     * implícito: es un 422.
     *
     * ⛔ Un 422 de «falta un dato» o de «la revisión ya no es vigente» trae la
     * lista entera de motivos en `blockers` ({@see documentBlockers()}), y
     * **no se reintenta solo**: hay que revisar de nuevo. Un 502 deja el envío
     * INCIERTO; consulta {@see signatureStatus()} antes de volver a mandar.
     *
     * @param array{name: string, email: string, send_email?: bool, subject?: string, body?: string, document_version_id?: string|null} $data
     */
    public function sendForSignature(int|string $id, array $data, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post("/contracts/{$id}/signature", $data, $idempotencyKey);
    }

    /**
     * Prepara el papel y devuelve su REVISIÓN: `reference`, hash, tamaño, si
     * lleva ancla y dónde la espera. **No envía**: no crea envelope, no manda
     * correos y no consume intento de firma.
     *
     * El recorrido es preparar → revisar los bytes con
     * {@see downloadDocumentPreview()} → enviar con esa `reference` en
     * {@see sendForSignature()}.
     *
     * Declarar `name`/`email` ATA la revisión a ese firmante: enviarla a otro
     * exigirá preparar otra. `source_document_sha256` identifica los BYTES y
     * es **evidencia, no autorización**: el servidor lo vuelve a comprobar
     * todo bajo bloqueo. Y no promete que el PDF firmado tenga ese hash: al
     * colocar la firma, el proveedor reescribe su propio documento.
     *
     * ⛔ Si falta un dato, 422 con TODOS los motivos en `blockers`. No lo
     * reintentes solo: cada preparación hornea otro PDF y retira la revisión
     * anterior.
     *
     * @param  array{name?: string|null, email?: string|null}  $data
     */
    public function documentPreview(int|string $id, array $data = [], ?string $idempotencyKey = null): mixed
    {
        // Sin datos, el cuerpo tiene que ser `{}`: un array PHP vacío se
        // serializa como `[]`, que no es el objeto que declara el contrato.
        return $this->client->post("/contracts/{$id}/document-preview", $data === [] ? new \stdClass() : $data, $idempotencyKey);
    }

    /**
     * Los bytes EXACTOS que se enviarán a firmar, servidos del archivo y nunca
     * regenerados: un PDF horneado de nuevo sería otro documento.
     *
     * Devuelve el PDF como cadena binaria (el transporte no decodifica lo que
     * no es JSON). Pásale la `reference` de la revisión; la `download_url` que
     * trae la preview es esta misma ruta ya compuesta.
     *
     * ⚠️ Puede ser 403 aunque la preview funcionara: los marcadores que exigen
     * permiso sobre lo que nombran —hoy el nombre de la obra— se vuelven a
     * comprobar al entregar el papel, porque los bytes archivados no heredan
     * la autorización con la que se crearon.
     */
    public function downloadDocumentPreview(int|string $id, string $reference): mixed
    {
        // El cliente pide JSON por defecto; aquí el 200 es `application/pdf`.
        return $this->client->request('GET', "/contracts/{$id}/document-preview/{$reference}", headers: ['accept' => '*/*']);
    }

    /**
     * Los motivos de un bloqueo, o `null` si el cuerpo no trae ninguno.
     *
     * ```php
     * try {
     *     $client->contracts->documentPreview(7);
     * } catch (ValidationException $e) {
     *     $motivos = Contracts::documentBlockers($e->body); // TODOS, no el primero
     * }
     * ```
     *
     * ⚠️ El spec publica el 422 genérico de validación porque el controlador
     * del núcleo contesta con un `response()->json()` que el generador no
     * inspecciona; `blockers` está medido en `ContractDocumentPreviewController`
     * y en `SendContractForSignatureController`.
     *
     * @return array<int, string>|null
     */
    public static function documentBlockers(mixed $body): ?array
    {
        if (! is_array($body) || ! isset($body['blockers']) || ! is_array($body['blockers'])) {
            return null;
        }

        $blockers = array_values($body['blockers']);

        foreach ($blockers as $blocker) {
            if (! is_string($blocker)) {
                return null;
            }
        }

        return $blockers;
    }

    /** Lee el estado del núcleo con `contracts:read`; no devuelve el enlace. */
    public function signatureStatus(int|string $id): mixed
    {
        return $this->client->get("/contracts/{$id}/signature");
    }

    /** Cancela la firma con `contracts:write`; no cancela el contrato. */
    public function cancelSignature(int|string $id): mixed
    {
        return $this->client->delete("/contracts/{$id}/signature");
    }

    /**
     * Recordatorio manual con `contracts:write`: el 202 acepta el correo,
     * no acredita su entrega ni vuelve a crear el envío remoto de firma.
     */
    public function remindSignature(int|string $id, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post("/contracts/{$id}/signature/remind", [], $idempotencyKey);
    }

    /**
     * Activa el contrato: DRAFT → ACTIVE, numera, y crea la recurrente
     * gobernada — o adopta la existente si pasas `$recurringInvoiceId` (misma
     * empresa y mismo cliente; sus líneas e impuestos no se tocan).
     *
     * ⚠️ **Solo en `INSTALLMENTS`.** `MILESTONES`, `ONE_OFF` y `NONE` pasan a
     * ACTIVE con las mismas guardas —numeración, firma vigente, bloqueo,
     * idempotencia— y sin crear ni una recurrente ni una factura;
     * `$recurringInvoiceId` en esos modos es un 422, no una adopción
     * silenciosa. El `invoices:write` es el máximo que declara el contrato
     * público y solo se exige de verdad en el modo que factura, resuelto con
     * el modo PERSISTIDO y no con el que mande el cliente.
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
