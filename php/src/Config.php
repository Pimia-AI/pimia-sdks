<?php

declare(strict_types=1);

namespace Pimia;

/**
 * Configuración de la conexión a un tenant de Pimia. Un tenant = una base URL
 * = un client registrado allí = un token.
 *
 * ⚠️ El `clientId` es lo que dice si esta configuración PUEDE hacer OAuth. Una
 * app que reenvía el token de su usuario no tiene client propio, y para ésa
 * está {@see self::forBorrowedToken()} — ver {@see self::ownsGrant()}.
 */
final class Config
{
    public readonly string $baseUrl;

    public function __construct(
        string $baseUrl,
        /** Vacío = esta configuración no tiene grant propio ({@see self::ownsGrant()}). */
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

    /**
     * Configuración para un cliente que **reenvía el token de otro**.
     *
     * Sin `clientId`, sin `clientSecret` y sin `redirectUri`: no hay ceremonia
     * OAuth que hacer porque el grant no es tuyo. Lo que queda es lo único que
     * sigue mandando en cada llamada — a qué tenant vas, qué cabeceras van
     * siempre (la `company` activa, tu User-Agent) y cómo tratas un 429.
     *
     * ⚠️ `maxRateLimitRetries` se deja en 0 cuando el cliente atiende una
     * petición HTTP de un usuario que está esperando: los reintentos del SDK
     * DUERMEN, y dormir 30 s dentro de una petición web es una petición colgada
     * y un proceso ocupado. Con reintentos a 0 el 429 sube como
     * {@see \Pimia\Exception\RateLimitException} y decides tú qué contestar.
     *
     * @param  array<string, string>  $headers
     */
    public static function forBorrowedToken(
        string $baseUrl,
        array $headers = [],
        int $maxRateLimitRetries = 2,
        int $maxRetryDelaySeconds = 30,
    ): self {
        return new self(
            baseUrl: $baseUrl,
            clientId: '',
            maxRateLimitRetries: $maxRateLimitRetries,
            maxRetryDelaySeconds: $maxRetryDelaySeconds,
            headers: $headers,
        );
    }

    /**
     * ¿Puede esta configuración pedir y refrescar tokens por su cuenta?
     *
     * Es lo que decide si {@see \Pimia\PimiaClient} monta un
     * {@see \Pimia\OAuth\OAuthClient} o deja `oauth` a `null`. Sin
     * `clientId` no hay a quién identificar ante el Authorization Server, así
     * que una ceremonia OAuth desde aquí saldría con `client_id=` vacío y
     * fallaría lejos, en el navegador del usuario.
     */
    public function ownsGrant(): bool
    {
        return $this->clientId !== '';
    }
}
