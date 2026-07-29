<?php

declare(strict_types=1);

namespace Pimia\Exception;

/** 429: pasado el rate limit. `$retryAfter` en segundos si la API lo dijo. */
class RateLimitException extends ApiException
{
    /**
     * @param  array<string, mixed>|string|null  $body
     */
    public function __construct(
        public readonly ?int $retryAfter,
        int $status,
        string $message,
        array|string|null $body = null,
        ?string $requestId = null,
    ) {
        parent::__construct($status, $message, $body, $requestId);
    }
}
