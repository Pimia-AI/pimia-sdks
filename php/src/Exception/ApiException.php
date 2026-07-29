<?php

declare(strict_types=1);

namespace Pimia\Exception;

/**
 * Respuesta HTTP de error de la API. `from()` la especializa según el contrato
 * de errores de Pimia (guia-integradores §7): un 403 por scope no se arregla
 * reintentando, un 422 tampoco, un 429 sí.
 */
class ApiException extends PimiaException
{
    /**
     * @param  array<string, mixed>|string|null  $body
     */
    public function __construct(
        public readonly int $status,
        string $message,
        public readonly array|string|null $body = null,
        public readonly ?string $requestId = null,
    ) {
        parent::__construct($message, $status);
    }

    /**
     * @param  array<string, mixed>|string|null  $body
     */
    public static function from(int $status, array|string|null $body, ?string $requestId = null): self
    {
        $message = self::messageFrom($body) ?? "HTTP {$status}";

        return match (true) {
            $status === 401 => new UnauthorizedException($status, $message, $body, $requestId),
            $status === 403 => self::forbidden($status, $message, $body, $requestId),
            $status === 404 => new NotFoundException($status, $message, $body, $requestId),
            $status === 422 => new ValidationException($status, $message, $body, $requestId),
            default => new self($status, $message, $body, $requestId),
        };
    }

    /**
     * @param  array<string, mixed>|string|null  $body
     */
    private static function forbidden(int $status, string $message, array|string|null $body, ?string $requestId): self
    {
        // «Token lacks the invoices:write scope» → el partner sabe qué pedir.
        if (preg_match('/Token lacks the (\S+) scope/', $message, $matches) === 1) {
            return new MissingScopeException($matches[1], $status, $message, $body, $requestId);
        }

        return new ForbiddenException($status, $message, $body, $requestId);
    }

    /**
     * @param  array<string, mixed>|string|null  $body
     */
    private static function messageFrom(array|string|null $body): ?string
    {
        if (is_string($body) && $body !== '') {
            return $body;
        }

        if (is_array($body)) {
            foreach (['message', 'error_description', 'error'] as $key) {
                if (isset($body[$key]) && is_string($body[$key]) && $body[$key] !== '') {
                    return $body[$key];
                }
            }
        }

        return null;
    }
}
