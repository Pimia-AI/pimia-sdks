<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\Exception\ApiException;
use Pimia\PimiaClient;

/**
 * La Mensajería de Pimia sobre wab-ai (`/api/v1/mensajeria/*`, factSaas#963):
 * el vínculo PERSONAL de quien mira, la bandeja, los mensajes, el envío
 * idempotente, los adjuntos, los medios y los chats nuevos. Exige
 * `messaging:read` / `messaging:write`, que son de PRIMERA PARTE: un client de
 * integrador no los obtiene, y con cualquier otro token la llamada es `403`.
 *
 * Nunca recibe organizaciones, claves ni ids de wab-ai: el servidor lo deriva
 * todo del vínculo de la persona en la empresa activa (cabecera `company`).
 * Todo error trae su `code` estable; {@see errorCode()} lo lee.
 *
 * Los ids de conversación, mensaje y operación son UUID de wab-ai; el
 * `operation_id` de un envío lo genera el cliente (un UUID v4 por mensaje) y es
 * a la vez la `Idempotency-Key` y el id del mensaje en wab-ai.
 */
final class Mensajeria
{
    /** El catálogo de `MensajeriaApiError` del núcleo. */
    public const ERROR_CODES = [
        'module_not_installed',
        'missing_scope',
        'forbidden',
        'company_mismatch',
        'messaging_link_missing',
        'messaging_link_pending',
        'messaging_link_revoked',
        'messaging_link_exists',
        'link_intent_in_progress',
        'link_cleanup_pending',
        'link_intent_expired',
        'member_key_invalid',
        'idempotency_key_reused',
        'idempotency_key_expired',
        'idempotency_in_progress',
        'wab_quota_exceeded',
        'wab_storage_quota_exceeded',
        'conversation_not_found',
        'operation_unknown',
        'operation_already_sent',
        'media_unavailable',
        'attachment_not_found',
        'attachment_too_large',
        'unsupported_media_type',
        'text_empty',
        'text_too_long',
        'send_not_supported',
        'validation_failed',
        'identifier_empty',
        'identifier_not_found',
        'network_not_configured',
        'network_account_missing',
        'wab_unavailable',
    ];

    public function __construct(private readonly PimiaClient $client)
    {
    }

    /**
     * El estado del vínculo en la empresa activa. Funciona con el módulo
     * apagado (`module: "off"`). `connected` solo si wab-ai lo confirmó en ESTA
     * llamada; ante la duda, `pending` con `reason: "wab_unavailable"`.
     */
    public function link(): mixed
    {
        return $this->client->get('/mensajeria/link');
    }

    /**
     * Abre un intento de vinculación y devuelve la `authorize_url` de wab-ai.
     * Uno vivo por persona: el nuevo sustituye al anterior.
     *
     * @param  'ajustes'|'mensajes'  $returnTo  Dónde vuelve la persona al terminar.
     */
    public function createLinkIntent(string $returnTo): mixed
    {
        return $this->client->post('/mensajeria/link/intents', ['return_to' => $returnTo]);
    }

    /**
     * Desvincula a quien mira. Idempotente. Si wab-ai no confirma la
     * revocación, `revoked` + `remote_cleanup_pending` (la termina un barrido).
     * No desconecta las redes de la organización en wab-ai.
     */
    public function unlink(): mixed
    {
        return $this->client->delete('/mensajeria/link');
    }

    /** Las cuentas (números y perfiles) de la organización vinculada. */
    public function accounts(): mixed
    {
        return $this->client->get('/mensajeria/accounts');
    }

    /**
     * La bandeja, por cursor (`meta.next_cursor`, opaco).
     *
     * @param  array{filter?: 'all'|'pending'|'24h'|'archived', q?: string, cursor?: string, limit?: int}  $query
     */
    public function conversations(array $query = []): mixed
    {
        return $this->client->get('/mensajeria/conversations', $query);
    }

    /** Una conversación; una ajena o desconocida es `404 conversation_not_found`. */
    public function conversation(string $conversationId): mixed
    {
        return $this->client->get('/mensajeria/conversations/'.rawurlencode($conversationId));
    }

    /** Marca la conversación como leída: `{data: {marked: int}}`. */
    public function markRead(string $conversationId): mixed
    {
        return $this->client->post('/mensajeria/conversations/'.rawurlencode($conversationId).'/read');
    }

    /**
     * Pausa, archiva o fija. Solo viajan las banderas no nulas, como booleanos
     * JSON; al menos una. Devuelve los tres sellos resultantes.
     */
    public function setFlags(string $conversationId, ?bool $paused = null, ?bool $archived = null, ?bool $pinned = null): mixed
    {
        $flags = array_filter(
            ['paused' => $paused, 'archived' => $archived, 'pinned' => $pinned],
            static fn (?bool $v) => $v !== null,
        );
        if ($flags === []) {
            throw new \InvalidArgumentException('setFlags() necesita al menos una bandera (paused, archived o pinned).');
        }

        return $this->client->patch('/mensajeria/conversations/'.rawurlencode($conversationId).'/flags', $flags);
    }

    /**
     * Los mensajes, del más nuevo al más viejo. `before` (el cursor anterior) y
     * `updated_since` (ISO) no van juntos: `422 validation_failed`.
     *
     * @param  array{before?: string, updated_since?: string, limit?: int}  $query
     */
    public function messages(string $conversationId, array $query = []): mixed
    {
        return $this->client->get('/mensajeria/conversations/'.rawurlencode($conversationId).'/messages', $query);
    }

    /**
     * Envía un texto. La `Idempotency-Key` es SIEMPRE `$operationId`: repetir
     * con el mismo id nunca duplica. Decide por `data.operation.state`:
     * `sent` (201), `uncertain` (202: NO generes otro id; reconcilia con
     * {@see operation()} o repite este envío) o `conflict` (200).
     */
    public function sendText(string $conversationId, string $operationId, string $text): mixed
    {
        return $this->send($conversationId, ['operation_id' => $operationId, 'kind' => 'text', 'text' => $text]);
    }

    /**
     * Envía un fichero ya subido con {@see uploadAttachment()} con el MISMO
     * `$operationId`, y un pie opcional.
     */
    public function sendFile(string $conversationId, string $operationId, string $attachmentId, ?string $caption = null): mixed
    {
        return $this->send($conversationId, [
            'operation_id' => $operationId,
            'kind' => 'file',
            'attachment_id' => $attachmentId,
            'text' => $caption,
        ]);
    }

    /**
     * El envío crudo (`SendMessageRequest`). Exige `operation_id`, que viaja
     * también como `Idempotency-Key`.
     *
     * @param  array{operation_id: string, kind: 'text'|'file'|'note', text?: string|null, attachment_id?: string|null}  $body
     */
    public function send(string $conversationId, array $body): mixed
    {
        $operationId = $body['operation_id'] ?? null;
        if (! is_string($operationId) || $operationId === '') {
            throw new \InvalidArgumentException('El envío necesita `operation_id` (un UUID por mensaje).');
        }

        return $this->client->post(
            '/mensajeria/conversations/'.rawurlencode($conversationId).'/messages',
            $body,
            $operationId,
        );
    }

    /**
     * Sube el fichero de un envío (multipart con `file` y `operation_id`).
     * `201` con el adjunto, o `202` con `{state: "upload_uncertain"}`: repite con
     * el mismo `$operationId` y los mismos bytes. Máximo 16 000 000 bytes
     * (`413`) y tipos cerrados (`415`); ya enviada, `409 operation_already_sent`.
     */
    public function uploadAttachment(
        string $conversationId,
        string $operationId,
        string $contents,
        string $filename,
        string $contentType = 'application/octet-stream',
    ): mixed {
        return $this->client->postMultipart(
            '/mensajeria/conversations/'.rawurlencode($conversationId).'/attachments',
            ['operation_id' => $operationId],
            ['file' => ['contents' => $contents, 'filename' => $filename, 'type' => $contentType]],
        );
    }

    /**
     * Los bytes EXACTOS del medio de un mensaje (el servidor manda siempre
     * `application/octet-stream`; el tipo real va en `content.file.mime_type`).
     * `$part` elige `parts[n]` en un mensaje compuesto.
     */
    public function media(string $messageId, ?int $part = null): string
    {
        return $this->client->download(
            '/mensajeria/messages/'.rawurlencode($messageId).'/media',
            $part === null ? [] : ['part' => $part],
        );
    }

    /**
     * Reconciliar un envío por su id. `404 operation_unknown`: wab-ai no lo
     * tiene y no es definitivo, así que se repite el envío con el MISMO id.
     */
    public function operation(string $operationId): mixed
    {
        return $this->client->get('/mensajeria/operations/'.rawurlencode($operationId));
    }

    /**
     * Los envíos sin cerrar de quien mira en una conversación.
     *
     * @param  string|null  $state  `pending`, `uncertain` o los dos separados por coma.
     */
    public function operations(string $conversationId, ?string $state = null): mixed
    {
        return $this->client->get(
            '/mensajeria/conversations/'.rawurlencode($conversationId).'/operations',
            $state === null ? [] : ['state' => $state],
        );
    }

    /**
     * Abre (o encuentra) un chat en una red puente. Crea una conversación REAL
     * en wab-ai: úsalo solo con identificadores que la persona escribió a
     * propósito.
     *
     * @param  'whatsapp'|'telegram'|'linkedin'|'facebook'|'instagram'  $network
     */
    public function createChat(string $network, string $identifier): mixed
    {
        return $this->client->post('/mensajeria/chats', ['network' => $network, 'identifier' => $identifier]);
    }

    /** El `code` de un error de `/mensajeria/*` si es del catálogo, o `null`. */
    public static function errorCode(\Throwable $error): ?string
    {
        if (! $error instanceof ApiException || ! is_array($error->body)) {
            return null;
        }
        $code = $error->body['code'] ?? $error->body['error'] ?? null;

        return in_array($code, self::ERROR_CODES, true) ? $code : null;
    }
}
