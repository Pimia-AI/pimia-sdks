<?php

declare(strict_types=1);

namespace Pimia\Tests;

use Pimia\Http\Response;
use Pimia\Http\Transport;

/** Transporte de mentira: graba las peticiones y devuelve lo que le digas. */
final class FakeTransport implements Transport
{
    /** @var list<array{method: string, url: string, headers: array<string, string>, body: ?string}> */
    public array $calls = [];

    /** @param \Closure(string, string, int): Response $handler */
    public function __construct(private readonly \Closure $handler)
    {
    }

    public function send(string $method, string $url, array $headers = [], ?string $body = null): Response
    {
        $this->calls[] = ['method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body];

        return ($this->handler)($method, $url, count($this->calls));
    }

    /** @param array<string, mixed> $body */
    public static function json(array $body, int $status = 200, array $headers = []): Response
    {
        return new Response($status, $body, array_merge(['content-type' => 'application/json'], $headers));
    }

    /** @return list<array{method: string, url: string, headers: array<string, string>, body: ?string}> */
    public function callsTo(string $needle): array
    {
        return array_values(array_filter($this->calls, static fn ($call) => str_contains($call['url'], $needle)));
    }
}
