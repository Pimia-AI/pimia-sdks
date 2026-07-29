<?php

declare(strict_types=1);

namespace Pimia;

use Pimia\Exception\ApiException;
use Pimia\Exception\NotAuthenticatedException;
use Pimia\Exception\RateLimitException;
use Pimia\Exception\UnauthorizedException;
use Pimia\Http\Transport;
use Pimia\OAuth\OAuthClient;
use Pimia\OAuth\TokenSet;
use Pimia\OAuth\TokenStore;
use Pimia\Resource\Customers;
use Pimia\Resource\Estimates;
use Pimia\Resource\Invoices;

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

    public function post(string $path, mixed $body = null): mixed
    {
        return $this->request('POST', $path, body: $body);
    }

    public function put(string $path, mixed $body = null): mixed
    {
        return $this->request('PUT', $path, body: $body);
    }

    public function patch(string $path, mixed $body = null): mixed
    {
        return $this->request('PATCH', $path, body: $body);
    }

    public function delete(string $path): mixed
    {
        return $this->request('DELETE', $path);
    }

    /**
     * Petición contra `/api/v1`. `$path` puede llevar el prefijo o no.
     *
     * @param  array<string, mixed>  $query
     */
    public function request(string $method, string $path, array $query = [], mixed $body = null): mixed
    {
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
                    ['authorization' => 'Bearer '.$tokens->accessToken],
                ),
                $payload,
            );

            $this->captureRateLimit($response);

            if ($response->isSuccessful()) {
                return $response->body;
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

        $rotated = $this->oauth->refresh($current->refreshToken);
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
