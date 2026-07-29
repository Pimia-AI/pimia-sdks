<?php

declare(strict_types=1);

namespace Pimia\Http;

use Psr\Http\Client\ClientExceptionInterface;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestFactoryInterface;
use Psr\Http\Message\StreamFactoryInterface;
use Pimia\Exception\PimiaException;

/**
 * Transporte sobre cualquier cliente PSR-18 (Guzzle, Symfony HttpClient,
 * Laravel…). El SDK no trae cliente propio: reusas el que ya tenga tu app.
 */
final class PsrTransport implements Transport
{
    public function __construct(
        private readonly ClientInterface $client,
        private readonly RequestFactoryInterface $requests,
        private readonly StreamFactoryInterface $streams,
    ) {
    }

    public function send(string $method, string $url, array $headers = [], ?string $body = null): Response
    {
        $request = $this->requests->createRequest($method, $url);

        foreach ($headers as $name => $value) {
            $request = $request->withHeader($name, $value);
        }

        if ($body !== null) {
            $request = $request->withBody($this->streams->createStream($body));
        }

        try {
            $response = $this->client->sendRequest($request);
        } catch (ClientExceptionInterface $e) {
            throw new PimiaException('Fallo de transporte HTTP: '.$e->getMessage(), 0, $e);
        }

        $normalized = [];
        foreach ($response->getHeaders() as $name => $values) {
            $normalized[strtolower((string) $name)] = implode(', ', $values);
        }

        return new Response(
            $response->getStatusCode(),
            self::decode((string) $response->getBody(), $normalized['content-type'] ?? ''),
            $normalized,
        );
    }

    /** @return array<string, mixed>|string|null */
    private static function decode(string $raw, string $contentType): array|string|null
    {
        if ($raw === '') {
            return null;
        }

        if (! str_contains($contentType, 'json')) {
            return $raw;
        }

        $decoded = json_decode($raw, true);

        return is_array($decoded) ? $decoded : $raw;
    }
}
