<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\Exception\ApiException;
use Pimia\PimiaClient;

/**
 * El correo de la empresa sobre Dead Simple Email (módulo de pago `mail`),
 * fase A del núcleo (factSaas#954): conexión, buzones, lectura y
 * administración. Exige `mail:read` / `mail:write`, que son de PRIMERA PARTE:
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

    /** Desconecta la instancia entera. Idempotente: responde `not_configured`. */
    public function disconnect(): mixed
    {
        return $this->client->delete('/mail/connection');
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

    /** Los bytes del adjunto, como cadena binaria (el transporte no decodifica lo que no es JSON). */
    public function attachment(string $mailboxId, string $attachmentId): mixed
    {
        return $this->client->request(
            'GET',
            '/mail/mailboxes/'.rawurlencode($mailboxId).'/attachments/'.rawurlencode($attachmentId),
            headers: ['accept' => '*/*'],
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
    public static function accessClosure(\Throwable $error): ?string
    {
        if (! $error instanceof ApiException || $error->status !== 403 || ! is_array($error->body)) {
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
