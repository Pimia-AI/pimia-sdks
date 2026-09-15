<?php

declare(strict_types=1);

namespace Pimia\Tests;

use PHPUnit\Framework\TestCase;
use Pimia\Exception\ApiException;
use Pimia\OwnerConfirmationRequired;
use Pimia\PimiaClient;

final class OwnerConfirmationTest extends TestCase
{
    public function test_el_202_de_las_operaciones_reservadas_no_se_desenvuelve_ni_se_reintenta(): void
    {
        $body = ['code' => OwnerConfirmationRequired::CODE, 'message' => 'Confirma por correo.', 'data' => ['id' => 45]];
        $spec = json_decode(file_get_contents(__DIR__.'/../../spec/pimia-api-v1.json'), true, 512, JSON_THROW_ON_ERROR);
        $operaciones = 0;
        foreach ($spec['paths'] as $path => $methods) {
            foreach ($methods as $method => $operation) {
                $codes = $operation['responses']['202']['content']['application/json']['schema']['properties']['code']['enum'] ?? [];
                if (! in_array(OwnerConfirmationRequired::CODE, $codes, true)) {
                    continue;
                }
                $operaciones++;
                $transport = new FakeTransport(static fn () => FakeTransport::json($body, 202));
                $client = PimiaClient::withBorrowedToken('https://example.test', 'test', $transport);
                $response = $client->requestWithMeta(strtoupper($method), str_replace(['{user}', '{role}'], ['3', 'admin'], $path));
                $this->assertSame(202, $response->meta->status);
                $this->assertSame($body, $response->data);
                $pending = OwnerConfirmationRequired::fromResponse($response->data);
                $this->assertSame(45, $pending?->id);
                $this->assertSame('Confirma por correo.', $pending?->message);
                $this->assertCount(1, $transport->calls);
            }
        }
        $this->assertSame(10, $operaciones);
    }

    public function test_el_503_conserva_el_codigo_sin_reintentar_la_accion(): void
    {
        $body = ['code' => OwnerConfirmationRequired::MAIL_FAILED_CODE, 'message' => 'No enviado'];
        $transport = new FakeTransport(static fn () => FakeTransport::json($body, 503));
        $client = PimiaClient::withBorrowedToken('https://example.test', 'test', $transport);
        try {
            $client->put('/users/3', ['role' => 'admin']);
            $this->fail('Debe fallar con 503');
        } catch (ApiException $e) {
            $this->assertSame(503, $e->status);
            $this->assertSame(OwnerConfirmationRequired::MAIL_FAILED_CODE, $e->body['code']);
            $this->assertCount(1, $transport->calls);
        }
    }

    public function test_no_confunde_un_recurso_ordinario_o_un_cuerpo_roto_con_una_confirmacion(): void
    {
        foreach ([null, [], ['data' => ['id' => 1]], ['code' => OwnerConfirmationRequired::CODE, 'message' => 'x', 'data' => ['id' => '1']]] as $body) {
            $this->assertNull(OwnerConfirmationRequired::fromResponse($body));
        }
    }
}
