<?php

declare(strict_types=1);

namespace Pimia;

use Pimia\Exception\ApiException;
use Pimia\Exception\NotAuthenticatedException;
use Pimia\Exception\OAuthException;
use Pimia\Exception\RateLimitException;
use Pimia\Exception\UnauthorizedException;
use Pimia\Http\ResponseMeta;
use Pimia\Http\ResponseWithMeta;
use Pimia\Http\Transport;
use Pimia\OAuth\OAuthClient;
use Pimia\OAuth\TokenSet;
use Pimia\OAuth\TokenStore;
use Pimia\Resource\Contracts;
use Pimia\Resource\Customers;
use Pimia\Resource\Estimates;
use Pimia\Resource\Invoices;
use Pimia\Resource\StockCounts;
use Pimia\Resource\Warehouses;

/**
 * Cliente de la API de Pimia.
 *
 * Lo que resuelve por ti, que es donde se equivoca una integración escrita a
 * mano: refresca al detectar caducidad o un 401 y **persiste el TokenSet
 * rotado** antes de reintentar (reusar un refresh viejo revoca el grant entero
 * en cascada), respeta `Retry-After` en los 429 y traduce los errores del
 * api-guard a excepciones tipadas (MissingScopeException trae el scope exacto).
 */
final class PimiaClient
{
    public readonly OAuthClient $oauth;

    public readonly Invoices $invoices;

    public readonly Customers $customers;

    public readonly Estimates $estimates;

    public readonly Contracts $contracts;

    public readonly Warehouses $warehouses;

    public readonly StockCounts $stockCounts;

    /** @var array{limit: ?int, remaining: ?int} */
    private array $rateLimit = ['limit' => null, 'remaining' => null];

    public function __construct(
        private readonly Config $config,
        private readonly Transport $transport,
        private readonly TokenStore $tokens,
        /** Inyectable para tests: sustituye a sleep(). */
        private readonly ?\Closure $sleeper = null,
    ) {
        $this->oauth = new OAuthClient($config, $transport);
        $this->invoices = new Invoices($this);
        $this->customers = new Customers($this);
        $this->estimates = new Estimates($this);
        $this->contracts = new Contracts($this);
        $this->warehouses = new Warehouses($this);
        $this->stockCounts = new StockCounts($this);
    }

    /** Cabeceras `X-RateLimit-*` de la última respuesta. */
    public function rateLimit(): array
    {
        return $this->rateLimit;
    }

    /** @param array<string, mixed> $query */
    public function get(string $path, array $query = []): mixed
    {
        return $this->request('GET', $path, query: $query);
    }

    /**
     * @param  string|null  $idempotencyKey  Clave de idempotencia: manda una
     *                                       única por operación (un UUID
     *                                       nuevo) y reúsala SOLO en los
     *                                       reintentos de esa misma. Pimia
     *                                       escribe una vez y reproduce la
     *                                       respuesta original; la misma clave
     *                                       con otro cuerpo responde 422. Para
     *                                       saber si lo recibido es un eco,
     *                                       usa {@see requestWithMeta()}.
     * @param  array<string, string>  $headers
     */
    public function post(string $path, mixed $body = null, ?string $idempotencyKey = null, array $headers = []): mixed
    {
        return $this->request('POST', $path, body: $body, idempotencyKey: $idempotencyKey, headers: $headers);
    }

    /** @param array<string, string> $headers */
    public function put(string $path, mixed $body = null, ?string $idempotencyKey = null, array $headers = []): mixed
    {
        return $this->request('PUT', $path, body: $body, idempotencyKey: $idempotencyKey, headers: $headers);
    }

    /** @param array<string, string> $headers */
    public function patch(string $path, mixed $body = null, ?string $idempotencyKey = null, array $headers = []): mixed
    {
        return $this->request('PATCH', $path, body: $body, idempotencyKey: $idempotencyKey, headers: $headers);
    }

    public function delete(string $path): mixed
    {
        return $this->request('DELETE', $path);
    }

    /**
     * Petición contra `/api/v1`. `$path` puede llevar el prefijo o no.
     *
     * @param  array<string, mixed>  $query
     * @param  array<string, string>  $headers
     */
    public function request(
        string $method,
        string $path,
        array $query = [],
        mixed $body = null,
        ?string $idempotencyKey = null,
        array $headers = [],
    ): mixed {
        return $this->requestWithMeta($method, $path, $query, $body, $idempotencyKey, $headers)->data;
    }

    /**
     * Lo mismo que {@see request()}, pero devuelve también los metadatos.
     *
     * Existe por la idempotencia: tras un reintento el cuerpo es idéntico al
     * de la primera llamada —ese es justo el contrato—, así que el cuerpo solo
     * no dice si Pimia escribió o se limitó a repetirse.
     * `$meta->idempotentReplay` sí.
     *
     * ```php
     * $clave = bin2hex(random_bytes(16));
     * $r = $client->requestWithMeta('POST', '/estimates', body: $datos, idempotencyKey: $clave);
     * if ($r->meta->idempotentReplay) {
     *     // el presupuesto ya existía; no se ha duplicado
     * }
     * ```
     *
     * @param  array<string, mixed>  $query
     * @param  array<string, string>  $headers
     */
    public function requestWithMeta(
        string $method,
        string $path,
        array $query = [],
        mixed $body = null,
        ?string $idempotencyKey = null,
        array $headers = [],
    ): ResponseWithMeta {
        $tokens = $this->currentTokens();

        if ($tokens->isExpired($this->config->expirySkewSeconds)) {
            $tokens = $this->refreshTokens($tokens);
        }

        $attempt = 0;
        $refreshedOn401 = false;
        $payload = $body === null ? null : json_encode($body, JSON_THROW_ON_ERROR);

        while (true) {
            $response = $this->transport->send(
                $method,
                $this->urlFor($path, $query),
                array_merge(
                    ['accept' => 'application/json'],
                    $payload === null ? [] : ['content-type' => 'application/json'],
                    $this->config->headers,
                    $headers,
                    // Después de $headers para que la opción con nombre mande
                    // sobre una cabecera puesta a mano: si alguien usa las dos,
                    // la explícita del API es la que quiso de verdad.
                    $idempotencyKey === null ? [] : ['idempotency-key' => $idempotencyKey],
                    ['authorization' => 'Bearer '.$tokens->accessToken],
                ),
                $payload,
            );

            $this->captureRateLimit($response);

            if ($response->isSuccessful()) {
                return new ResponseWithMeta(
                    $response->body,
                    new ResponseMeta(
                        status: $response->status,
                        // Presente solo cuando Pimia reproduce; su ausencia
                        // significa «esta escritura ocurrió de verdad».
                        idempotentReplay: $response->header('idempotency-replayed') === 'true',
                        requestId: $response->header('x-request-id'),
                        rateLimit: $this->rateLimit,
                    ),
                );
            }

            $requestId = $response->header('x-request-id');

            // 401: un intento de refresco y se reintenta. Si el usuario revocó
            // la app, el refresh también falla y el error sube tal cual.
            if ($response->status === 401 && ! $refreshedOn401 && $tokens->refreshToken !== null) {
                $refreshedOn401 = true;
                $tokens = $this->refreshTokens($tokens);

                continue;
            }

            if ($response->status === 429 && $attempt < $this->config->maxRateLimitRetries) {
                $attempt++;
                $this->sleep($this->retryDelay($response, $attempt));

                continue;
            }

            if ($response->status === 429) {
                throw new RateLimitException(
                    $this->retryAfter($response),
                    429,
                    'Rate limit alcanzado',
                    $response->body,
                    $requestId,
                );
            }

            throw ApiException::from($response->status, $response->body, $requestId);
        }
    }

    private function currentTokens(): TokenSet
    {
        $tokens = $this->tokens->load();

        if ($tokens === null || $tokens->accessToken === '') {
            throw new NotAuthenticatedException(
                'No hay tokens en el TokenStore: completa el flujo de autorización antes de llamar a la API.',
            );
        }

        return $tokens;
    }

    /** Refresca y PERSISTE la rotación: sin esto, el siguiente refresh es un reuse. */
    private function refreshTokens(TokenSet $current): TokenSet
    {
        if ($current->refreshToken === null) {
            throw new UnauthorizedException(
                401,
                'El access token caducó y no hay refresh token: vuelve a pedir autorización al usuario.',
            );
        }

        try {
            $rotated = $this->oauth->refresh($current->refreshToken);
        } catch (OAuthException $e) {
            // Un refresco fallido significa siempre lo mismo para quien llama:
            // este grant ya no vale y hay que volver a pedir autorización
            // (revocó la app, caducó el refresh, o se reusó uno rotado). Se
            // traduce a UnauthorizedException para que un solo catch cubra el
            // caso — detectado en el e2e real del SDK TS contra dev.
            throw new UnauthorizedException(
                401,
                "No se pudo refrescar el token ({$e->error}): vuelve a pedir autorización al usuario.",
                null,
                null,
                $e,
            );
        }

        $this->tokens->save($rotated);

        return $rotated;
    }

    /** @param array<string, mixed> $query */
    private function urlFor(string $path, array $query): string
    {
        $clean = preg_replace('#^(api/v1/?)#', '', ltrim($path, '/')) ?? '';
        $url = $this->config->baseUrl.'/api/v1/'.$clean;

        $filtered = array_filter($query, static fn ($value) => $value !== null);

        return $filtered === [] ? $url : $url.'?'.http_build_query($filtered);
    }

    private function captureRateLimit(Http\Response $response): void
    {
        $limit = $response->header('x-ratelimit-limit');
        $remaining = $response->header('x-ratelimit-remaining');

        $this->rateLimit = [
            'limit' => $limit === null ? null : (int) $limit,
            'remaining' => $remaining === null ? null : (int) $remaining,
        ];
    }

    private function retryDelay(Http\Response $response, int $attempt): int
    {
        $retryAfter = $this->retryAfter($response);
        $base = $retryAfter ?? (int) (2 ** $attempt);

        return min($base, $this->config->maxRetryDelaySeconds);
    }

    private function retryAfter(Http\Response $response): ?int
    {
        $header = $response->header('retry-after');

        return $header !== null && ctype_digit($header) ? (int) $header : null;
    }

    private function sleep(int $seconds): void
    {
        if ($this->sleeper !== null) {
            ($this->sleeper)($seconds);

            return;
        }

        if ($seconds > 0) {
            sleep($seconds);
        }
    }
}
