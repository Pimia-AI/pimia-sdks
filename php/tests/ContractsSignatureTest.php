<?php

declare(strict_types=1);

namespace Pimia\Tests;

use PHPUnit\Framework\TestCase;
use Pimia\PimiaClient;

final class ContractsSignatureTest extends TestCase
{
    public function test_las_cuatro_acciones_conservan_rutas_cuerpos_y_respuestas(): void
    {
        $signature = [
            'status' => 'SENT', 'version' => 1, 'sent_at' => '2026-09-22T10:00:00Z',
            'signed_at' => null, 'source_document_sha256' => str_repeat('a', 64),
            'signed_document_sha256' => null,
        ];
        $envelope = ['data' => ['id' => 7, 'signature' => $signature]];
        $responses = [
            $envelope + ['signingUrl' => 'https://firma.example.test/capacidad-ficticia'],
            $envelope,
            ['data' => ['id' => 7, 'signature' => array_replace($signature, ['status' => 'NONE'])]],
            ['success' => true],
        ];
        $transport = new FakeTransport(static fn (string $method, string $url, int $n) =>
            FakeTransport::json($responses[$n - 1], $n === 4 ? 202 : 200));
        $client = PimiaClient::withBorrowedToken(
            'https://acme.pimia.es', 'token-ficticio', $transport, ['company' => '3'],
        );
        $body = ['name' => 'Ana', 'email' => 'ana@example.test', 'send_email' => false, 'subject' => 'Firma', 'body' => 'Tu contrato'];

        $this->assertSame($responses[0], $client->contracts->sendForSignature(7, $body, 'firma-send'));
        $this->assertSame($responses[1], $client->contracts->signatureStatus('7'));
        $this->assertSame($responses[2], $client->contracts->cancelSignature(7));
        $this->assertSame($responses[3], $client->contracts->remindSignature('7', 'firma-remind'));
        $this->assertCount(4, $transport->calls);

        foreach (['POST', 'GET', 'DELETE', 'POST'] as $i => $method) {
            $call = $transport->calls[$i];
            $suffix = $i === 3 ? '/remind' : '';
            $this->assertSame('https://acme.pimia.es/api/v1/contracts/7/signature'.$suffix, $call['url']);
            $this->assertSame($method, $call['method']);
            $this->assertSame('3', $call['headers']['company']);
        }
        // El false explícito evita enviar correo cuando el integrador gestiona el enlace.
        $this->assertSame($body, json_decode($transport->calls[0]['body'], true));
        $this->assertSame('firma-send', $transport->calls[0]['headers']['idempotency-key']);
        $this->assertNull($transport->calls[1]['body']);
        $this->assertNull($transport->calls[2]['body']);
        $this->assertSame([], json_decode($transport->calls[3]['body'], true));
        $this->assertSame('firma-remind', $transport->calls[3]['headers']['idempotency-key']);
    }
}
