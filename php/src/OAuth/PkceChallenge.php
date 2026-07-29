<?php

declare(strict_types=1);

namespace Pimia\OAuth;

/**
 * PKCE S256 (RFC 7636). Obligatorio para clients públicos y recomendable
 * siempre: liga el código de autorización a quien lo pidió. Guarda el
 * `verifier` en la sesión del usuario hasta que vuelva del callback.
 */
final class PkceChallenge
{
    public const METHOD = 'S256';

    private function __construct(
        public readonly string $verifier,
        public readonly string $challenge,
    ) {
    }

    public static function create(): self
    {
        $verifier = self::base64Url(random_bytes(32));

        return new self($verifier, self::base64Url(hash('sha256', $verifier, true)));
    }

    /** Rehidrata el challenge desde el verifier guardado en sesión. */
    public static function fromVerifier(string $verifier): self
    {
        return new self($verifier, self::base64Url(hash('sha256', $verifier, true)));
    }

    /** `state` anti-CSRF. Compáralo al volver del callback. */
    public static function state(): string
    {
        return self::base64Url(random_bytes(16));
    }

    private static function base64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
