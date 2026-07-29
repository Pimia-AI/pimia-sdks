<?php

declare(strict_types=1);

namespace Pimia\OAuth;

/**
 * Conjunto de tokens de una autorización. Inmutable: un refresco produce un
 * TokenSet NUEVO que hay que persistir (ver TokenStore).
 */
final class TokenSet implements \JsonSerializable
{
    public function __construct(
        public readonly string $accessToken,
        /** Ausente si el operador desactivó los refresh (OAUTH_ACCESS_TOKEN_TTL=0). */
        public readonly ?string $refreshToken = null,
        /** Epoch en segundos. Null = el servidor no dio expiración. */
        public readonly ?int $expiresAt = null,
        public readonly ?string $scope = null,
        public readonly string $tokenType = 'bearer',
    ) {
    }

    /**
     * Respuesta cruda del token endpoint → TokenSet.
     *
     * @param  array<string, mixed>  $payload
     */
    public static function fromResponse(array $payload, ?int $now = null): self
    {
        $now ??= time();

        return new self(
            accessToken: (string) ($payload['access_token'] ?? ''),
            refreshToken: isset($payload['refresh_token']) ? (string) $payload['refresh_token'] : null,
            expiresAt: isset($payload['expires_in']) ? $now + (int) $payload['expires_in'] : null,
            scope: isset($payload['scope']) ? (string) $payload['scope'] : null,
            tokenType: (string) ($payload['token_type'] ?? 'bearer'),
        );
    }

    /** ¿Caduca dentro de `$skewSeconds`? Sin expiresAt se asume vivo. */
    public function isExpired(int $skewSeconds = 60, ?int $now = null): bool
    {
        if ($this->expiresAt === null) {
            return false;
        }

        return $this->expiresAt - $skewSeconds <= ($now ?? time());
    }

    /** @return list<string> */
    public function scopes(): array
    {
        if ($this->scope === null || trim($this->scope) === '') {
            return [];
        }

        return preg_split('/\s+/', trim($this->scope)) ?: [];
    }

    /** @param array<string, mixed> $data */
    public static function fromArray(array $data): self
    {
        return new self(
            accessToken: (string) ($data['access_token'] ?? $data['accessToken'] ?? ''),
            refreshToken: $data['refresh_token'] ?? $data['refreshToken'] ?? null,
            expiresAt: isset($data['expires_at']) ? (int) $data['expires_at'] : ($data['expiresAt'] ?? null),
            scope: $data['scope'] ?? null,
            tokenType: (string) ($data['token_type'] ?? $data['tokenType'] ?? 'bearer'),
        );
    }

    /** @return array<string, mixed> */
    public function jsonSerialize(): array
    {
        return [
            'access_token' => $this->accessToken,
            'refresh_token' => $this->refreshToken,
            'expires_at' => $this->expiresAt,
            'scope' => $this->scope,
            'token_type' => $this->tokenType,
        ];
    }
}
