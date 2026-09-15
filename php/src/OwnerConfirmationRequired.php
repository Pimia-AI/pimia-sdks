<?php

declare(strict_types=1);

namespace Pimia;

/** El 202 no es el recurso creado: la acción espera confirmación del dueño. */
final class OwnerConfirmationRequired
{
    public const CODE = 'owner_confirmation_required';
    public const MAIL_FAILED_CODE = 'owner_confirmation_mail_failed';

    private function __construct(
        public readonly int $id,
        public readonly string $message,
    ) {
    }

    /** Reconoce el cuerpo crudo de post/put/delete/request sin alterar su respuesta. */
    public static function fromResponse(mixed $body): ?self
    {
        if (! is_array($body) || ($body['code'] ?? null) !== self::CODE
            || ! is_string($body['message'] ?? null) || ! is_array($body['data'] ?? null)
            || ! is_int($body['data']['id'] ?? null)) {
            return null;
        }

        return new self($body['data']['id'], $body['message']);
    }
}
