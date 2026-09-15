<?php

declare(strict_types=1);

namespace Pimia\Tests;

use PHPUnit\Framework\TestCase;
use Pimia\Config;
use Pimia\PimiaClient;

final class BaseUrlTest extends TestCase
{
    public function test_rechaza_prefijos_en_config_y_token_prestado_sin_red(): void
    {
        $transport = new FakeTransport(static fn () => FakeTransport::json([]));
        foreach (['/api', '/api/', '/api/v1', '/api/v1///', '/api?x=1', '/api/v1/#fragmento'] as $suffix) {
            foreach ([
                static fn () => new Config('https://acme.pimia.es'.$suffix, 'fixture'),
                static fn () => PimiaClient::withBorrowedToken('https://acme.pimia.es'.$suffix, 'fixture', $transport),
            ] as $make) {
                try {
                    $make();
                    $this->fail('Debía rechazar '.$suffix);
                } catch (\InvalidArgumentException $e) {
                    $this->assertStringContainsString('baseUrl debe ser el origen', $e->getMessage());
                    $this->assertStringContainsString('sin /api ni /api/v1', $e->getMessage());
                }
            }
        }
        $this->assertSame([], $transport->calls);
    }

    public function test_conserva_origen_puerto_y_barras_finales(): void
    {
        foreach (['https://acme.pimia.es', 'http://localhost:4319', 'https://api'] as $base) {
            foreach (['', '/', '///'] as $tail) {
                $transport = new FakeTransport(static fn () => FakeTransport::json([]));
                $client = PimiaClient::withBorrowedToken($base.$tail, 'fixture', $transport);
                $client->get('/customers');
                $this->assertSame($base.'/api/v1/customers', $transport->calls[0]['url']);
            }
        }
    }
}
