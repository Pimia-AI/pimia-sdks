<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\Exception\ApiException;
use Pimia\PimiaClient;

/**
 * El correo de la empresa sobre Dead Simple Email (módulo de pago `mail`):
 * conexión, buzones, lectura y administración (fase A, factSaas#954) y
 * borradores, envío y acciones sobre propuestas (fase B, factSaas#957). Exige `mail:read` / `mail:write`, que son de PRIMERA PARTE:
 * un client de integrador no los obtiene.
 *
 * Tres puertas en todas las rutas, y el cuerpo de error trae el `code`
 * estable:
 *
 *  1. el módulo: `403 module_not_installed` si está apagado;
 *  2. la empresa activa: un id de otra empresa (o de otro buzón) es `404`;
 *  3. la membresía: el contenido exige ser miembro VIVO; administrar
 *     (`configure-mail`) no da contenido y un admin sin membresía recibe
 *     `403 mailbox_access_revoked`.
 *
 * {@see accessClosure()} dice si un error CIERRA el acceso o es un fallo
 * pasajero. Un fallo del proveedor es `502`/`503`, nunca un `200` vacío.
 *
 * Los ids de buzón, mensaje, adjunto y propuesta son `public_id` opacos
 * (cadenas); los de USUARIO son el id numérico de Pimia.
 */
final class Mail
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /** La conexión de la INSTANCIA. Sin conexión: `status: not_configured`, no un 404. */
    public function connection(): mixed
    {
        return $this->client->get('/mail/connection');
    }

    /**
     * Conecta (o reconecta) Dead Simple. La clave viaja una vez y no vuelve en
     * ninguna respuesta. Con `$idempotencyKey`, el reintento devuelve el estado
     * actual sin repetir la conexión. Cambiar a OTRA cuenta con altas sin
     * terminar es `409 connection_has_pending_operations`.
     *
     * @param  array{api_key: string, domain?: string|null}  $data
     */
    public function connect(array $data, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post('/mail/connection', $data, $idempotencyKey);
    }

    /**
     * Desconecta la instancia entera. Idempotente: responde `not_configured`.
     * Si el proveedor no deja retirar el webhook, `202` con `status:
     * "disconnect_pending"`: la terminan el reintento de esta baja (con la
     * MISMA `$idempotencyKey`) o el barrido; mientras tanto, reconectar es
     * `409 connection_disconnecting`.
     */
    public function disconnect(?string $idempotencyKey = null): mixed
    {
        return $this->client->request('DELETE', '/mail/connection', idempotencyKey: $idempotencyKey);
    }

    /** Los buzones que quien mira puede LEER (membresía viva). */
    public function mailboxes(): mixed
    {
        return $this->client->get('/mail/mailboxes');
    }

    /**
     * Por cursor: `meta.next_cursor` (opaco) y `meta.history_complete`.
     *
     * @param  array<string, mixed>  $query  `folder` (inbox|sent), `q`, `cursor`, `limit`
     */
    public function messages(string $mailboxId, array $query = []): mixed
    {
        return $this->client->get('/mail/mailboxes/'.rawurlencode($mailboxId).'/messages', $query);
    }

    /** El mensaje en TEXTO PLANO (`text_body`); el HTML no sale nunca. */
    public function message(string $mailboxId, string $messageId): mixed
    {
        return $this->client->get('/mail/mailboxes/'.rawurlencode($mailboxId).'/messages/'.rawurlencode($messageId));
    }

    /** Leído o no leído, POR USUARIO. Responde `204`. */
    public function markRead(string $mailboxId, string $messageId, bool $read = true): mixed
    {
        return $this->client->patch(
            '/mail/mailboxes/'.rawurlencode($mailboxId).'/messages/'.rawurlencode($messageId),
            ['read' => $read],
        );
    }

    /**
     * Los bytes EXACTOS del adjunto, sea cual sea su tipo: un adjunto que es un
     * `.json` (o `+json`, o un fichero vacío) vuelve como cadena, no decodificado.
     * Va por {@see PimiaClient::download()}, que no pasa la respuesta buena por
     * el decodificador; un error (4xx/5xx) sigue siendo su excepción.
     */
    public function attachment(string $mailboxId, string $attachmentId): string
    {
        return $this->client->download(
            '/mail/mailboxes/'.rawurlencode($mailboxId).'/attachments/'.rawurlencode($attachmentId),
        );
    }

    /** @param  array<string, mixed>  $query  `cursor`, `limit` */
    public function proposals(string $mailboxId, array $query = []): mixed
    {
        return $this->client->get('/mail/mailboxes/'.rawurlencode($mailboxId).'/proposals', $query);
    }

    public function proposal(string $proposalId): mixed
    {
        return $this->client->get('/mail/proposals/'.rawurlencode($proposalId));
    }

    /**
     * Abre (o reabre: uno por persona y propuesta) el borrador nacido de una
     * propuesta, para revisarla y enviarla con {@see sendDraft()}.
     */
    public function draftFromProposal(string $proposalId): mixed
    {
        return $this->client->post('/mail/proposals/'.rawurlencode($proposalId).'/draft');
    }

    /**
     * Descarta la propuesta en la `$version` que vio la persona. Otra versión,
     * o una propuesta que ya no está pendiente, es `409 proposal_changed`.
     * Responde `204`.
     */
    public function discardProposal(string $proposalId, int $version): mixed
    {
        return $this->client->post('/mail/proposals/'.rawurlencode($proposalId).'/discard', ['version' => $version]);
    }

    /**
     * La carpeta «Borradores»: los de QUIEN MIRA en ese buzón, con la forma de
     * {@see messages()}.
     *
     * @param  array<string, mixed>  $query  `cursor`, `limit`
     */
    public function drafts(string $mailboxId, array $query = []): mixed
    {
        return $this->messages($mailboxId, ['folder' => 'drafts'] + $query);
    }

    /**
     * Crea un borrador en `mailbox_id`. Para RESPONDER,
     * `in_reply_to_message_id` con el id de un mensaje de ese buzón. Con
     * `$idempotencyKey`, el reintento devuelve `200` con ese borrador.
     *
     * @param  array<string, mixed>  $data  `mailbox_id`, `to`, `cc`, `bcc`, `subject`, `text_body`, `in_reply_to_message_id`
     */
    public function createDraft(array $data, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post('/mail/drafts', $data, $idempotencyKey);
    }

    /** El borrador (solo el de su AUTOR: el de otra persona es `404`). */
    public function draft(string $draftId): mixed
    {
        return $this->client->get('/mail/drafts/'.rawurlencode($draftId));
    }

    /**
     * Guarda solo las claves presentes. `version` es OBLIGATORIA: si cambió,
     * `409 draft_changed`; con un envío sin resolver, `409 draft_locked`.
     *
     * @param  array<string, mixed>  $data
     */
    public function updateDraft(string $draftId, array $data): mixed
    {
        return $this->client->put('/mail/drafts/'.rawurlencode($draftId), $data);
    }

    /** Borra el borrador y sus ficheros. Responde `204`. */
    public function deleteDraft(string $draftId): mixed
    {
        return $this->client->delete('/mail/drafts/'.rawurlencode($draftId));
    }

    /**
     * Adjunta un fichero (multipart con `file`). Los límites están en
     * `connection.limits`; el tipo lo decide el servidor por los bytes. SUBE la
     * versión del borrador.
     */
    public function attach(
        string $draftId,
        string $contents,
        string $filename,
        ?int $version = null,
        string $contentType = 'application/octet-stream',
        ?string $idempotencyKey = null,
    ): mixed {
        return $this->client->postMultipart(
            '/mail/drafts/'.rawurlencode($draftId).'/attachments',
            ['version' => $version],
            ['file' => ['contents' => $contents, 'filename' => $filename, 'type' => $contentType]],
            $idempotencyKey,
        );
    }

    /** Quita un adjunto en la `$version` que tenía delante la persona. */
    public function detach(string $draftId, string $attachmentId, ?int $version = null): mixed
    {
        return $this->client->request(
            'DELETE',
            '/mail/drafts/'.rawurlencode($draftId).'/attachments/'.rawurlencode($attachmentId),
            query: $version === null ? [] : ['version' => $version],
        );
    }

    /**
     * Pide el envío de la `$version` que tenía delante la persona. Responde
     * `202` con la operación (`pending`); su estado, {@see sendOperation()}.
     *
     * La `$idempotencyKey` es OBLIGATORIA, una por intento y la MISMA en cada
     * reintento: misma clave, borrador y persona → la MISMA operación. Otra
     * clave con un envío sin resolver es `409 send_in_progress`.
     */
    public function sendDraft(string $draftId, int $version, string $idempotencyKey): mixed
    {
        return $this->client->post('/mail/drafts/'.rawurlencode($draftId).'/send', ['version' => $version], $idempotencyKey);
    }

    /**
     * El estado de un envío: `pending`, `accepted`, `delivered`, `failed`
     * (no salió), `unknown` (no se sabe: NO reenviar) o `review_required`.
     */
    public function sendOperation(string $operationId): mixed
    {
        return $this->client->get('/mail/send-operations/'.rawurlencode($operationId));
    }

    /** Administración (`configure-mail`): todos los buzones de la empresa, SIN contenido. */
    public function adminMailboxes(): mixed
    {
        return $this->client->get('/mail/admin/mailboxes');
    }

    /**
     * Da de alta un buzón. La `Idempotency-Key` es OBLIGATORIA (el núcleo la
     * exige y la reenvía al proveedor): una por alta, y la MISMA en el
     * reintento tras un `502 provider_outcome_unknown`, o se crearían dos.
     * `personal` exige `owner_user_id`; un `shared` nace sin miembros.
     *
     * `/mail` no usa el replay genérico: el reintento de un alta que SÍ llegó
     * responde `200` con el mismo buzón (la primera vez, `201`). La misma clave
     * con otro cuerpo es `422 idempotency_key_reused`; una reserva de más de
     * 24 h, `409 idempotency_key_expired`; y si la conexión cambió de cuenta,
     * `409 idempotency_account_changed`.
     *
     * @param  array<string, mixed>  $data  `kind`, `mode`, `local_part`, `address`, `display_name`, `owner_user_id`
     */
    public function createMailbox(array $data, string $idempotencyKey): mixed
    {
        return $this->client->post('/mail/admin/mailboxes', $data, $idempotencyKey);
    }

    /** @param  array{display_name?: string|null, status?: string}  $data */
    public function updateMailbox(string $mailboxId, array $data): mixed
    {
        return $this->client->patch('/mail/admin/mailboxes/'.rawurlencode($mailboxId), $data);
    }

    /**
     * Los buzones de la cuenta del proveedor, para vincular (`mode: link`).
     *
     * @param  array<string, mixed>  $query
     */
    public function providerMailboxes(array $query = []): mixed
    {
        return $this->client->get('/mail/admin/provider-mailboxes', $query);
    }

    public function members(string $mailboxId): mixed
    {
        return $this->client->get('/mail/admin/mailboxes/'.rawurlencode($mailboxId).'/members');
    }

    /** Usuarios de la EMPRESA DEL BUZÓN que aún no son miembros. */
    public function memberCandidates(string $mailboxId): mixed
    {
        return $this->client->get('/mail/admin/mailboxes/'.rawurlencode($mailboxId).'/member-candidates');
    }

    /**
     * Un usuario de otra empresa es `422 user_not_in_company`; uno inexistente,
     * `404`. Con `$idempotencyKey`, el reintento devuelve los miembros ACTUALES.
     */
    public function addMember(string $mailboxId, int $userId, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post('/mail/admin/mailboxes/'.rawurlencode($mailboxId).'/members', ['user_id' => $userId], $idempotencyKey);
    }

    /**
     * Revoca la membresía (no la borra: queda en el libro). Con
     * `$idempotencyKey`, un reintento VIEJO no revoca un alta posterior.
     */
    public function removeMember(string $mailboxId, int $userId, ?string $idempotencyKey = null): mixed
    {
        return $this->client->request(
            'DELETE',
            '/mail/admin/mailboxes/'.rawurlencode($mailboxId).'/members/'.$userId,
            idempotencyKey: $idempotencyKey,
        );
    }

    /**
     * Si un error del correo CIERRA el acceso: `'module_disabled'`
     * (`module_not_installed`), `'access_revoked'` (`mailbox_access_revoked`),
     * `'company_not_allowed'` (la cabecera `company` nombra una empresa a la
     * que ya no se pertenece: se cierra el ámbito entero) o `null` —un fallo
     * del proveedor no cierra nada: no se sabe qué hay—.
     */
    public const SENDING_ERROR_CODES = [
        'draft_changed',
        'draft_locked',
        'draft_not_editable',
        'send_in_progress',
        'proposal_changed',
        'mail_not_configured',
        'connection_disconnecting',
        'idempotency_key_required',
        'idempotency_key_invalid',
        'idempotency_key_reused',
    ];

    /**
     * El código estable del ENVÍO de un error de `/mail` (fase B) —
     * `draft_changed`, `draft_locked`, `draft_not_editable`,
     * `send_in_progress`, `proposal_changed`, `mail_not_configured`,
     * `connection_disconnecting`, `idempotency_key_*`— o `null`.
     */
    public static function sendingError(\Throwable $error): ?string
    {
        if (! $error instanceof ApiException || ! is_array($error->body)) {
            return null;
        }
        $code = $error->body['code'] ?? $error->body['error'] ?? null;

        return in_array($code, self::SENDING_ERROR_CODES, true) ? $code : null;
    }

    public static function accessClosure(\Throwable $error): ?string
    {
        if (! $error instanceof ApiException) {
            return null;
        }
        // TODO 402 cierra el módulo, con o sin código: `subscription_required`
        // (el módulo de pago sin plan), `tenant_suspended`… o ninguno. Es un
        // NO del servidor al módulo entero, no un fallo pasajero.
        if ($error->status === 402) {
            return 'module_disabled';
        }
        if ($error->status !== 403 || ! is_array($error->body)) {
            return null;
        }
        $code = $error->body['code'] ?? $error->body['error'] ?? null;

        return match ($code) {
            'module_not_installed' => 'module_disabled',
            'mailbox_access_revoked' => 'access_revoked',
            'company_not_allowed' => 'company_not_allowed',
            default => null,
        };
    }
}
