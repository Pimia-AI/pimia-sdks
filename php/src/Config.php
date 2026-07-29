<?php

declare(strict_types=1);

namespace Pimia;

/**
 * Configuración de la conexión a un tenant de Pimia. Un tenant = una base URL
 * = un client registrado allí = un token.
 */
final class Config
{
    public readonly string $baseUrl;

    public function __construct(
        string $baseUrl,
        public readonly string $clientId,
        /** Solo clients confidenciales (app server-side). */
        public readonly ?string $clientSecret = null,
        public readonly string $redirectUri = '',
        /** Segundos de margen para refrescar antes de que caduque. */
        public readonly int $expirySkewSeconds = 60,
        /** Reintentos ante 429. */
        public readonly int $maxRateLimitRetries = 2,
        /** Espera máxima por reintento de 429, en segundos. */
        public readonly int $maxRetryDelaySeconds = 30,
        /** Cabeceras extra en cada petición (p. ej. un User-Agent propio). */
        public readonly array $headers = [],
    ) {
        $this->baseUrl = rtrim($baseUrl, '/');
    }
}
