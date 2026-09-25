<?php

declare(strict_types=1);

namespace Pimia\Tests;

use PHPUnit\Framework\TestCase;
use Pimia\Config;
use Pimia\Http\Response;
use Pimia\OAuth\InMemoryTokenStore;
use Pimia\OAuth\TokenSet;
use Pimia\PimiaClient;
use Pimia\Resource\Mensajeria;

/**
 * La Mensajería sobre wab-ai (factSaas#963): rutas, la Idempotency-Key del
 * envío atada a su `operation_id`, el multipart del adjunto, los bytes del
 * medio y el catálogo de códigos.
 */
final class MensajeriaTest extends TestCase
{
    private const BASE = 'https://acme.pimia.es';

    private const CONV = '0f96caec-0000-4000-8000-000000000001';

    private const OP = '5b1d7c9e-3a2f-4e8b-9c1d-2f3e4a5b6c7d';

    /** @return array{PimiaClient, FakeTransport} */
    private function client(\Closure $handler): array
    {
        $transport = new FakeTransport($handler);
        $client = new PimiaClient(
            new Config(
                baseUrl: self::BASE,
                clientId: 'mcp_test',
                clientSecret: 'pcs_test',
                redirectUri: 'https://pimia.example/cb',
            ),
            $transport,
            new InMemoryTokenStore(new TokenSet('at-1')),
            static function (int $seconds) {},
        );

        return [$client, $transport];
    }

    public function test_cada_operacion_pega_en_su_ruta_y_con_su_metodo(): void
    {
        [$client, $transport] = $this->client(static fn () => FakeTransport::json(['data' => []]));
        $m = $client->mensajeria;

        $m->link();
        $m->createLinkIntent('mensajes');
        $m->unlink();
        $m->accounts();
        $m->conversations(['filter' => '24h', 'cursor' => 'c/2', 'limit' => 20]);
        $m->conversation(self::CONV);
        $m->markRead(self::CONV);
        $m->setFlags(self::CONV, archived: true, pinned: false);
        $m->messages(self::CONV, ['before' => 'cur']);
        $m->operation(self::OP);
        $m->operations(self::CONV, 'uncertain');
        $m->createChat('telegram', '@alguien');
        $m->conversation('../link?x=1');

        $vistas = array_map(
            static fn (array $c) => $c['method'].' '.substr($c['url'], strlen(self::BASE)),
            $transport->calls,
        );
        $this->assertSame([
            'GET /api/v1/mensajeria/link',
            'POST /api/v1/mensajeria/link/intents',
            'DELETE /api/v1/mensajeria/link',
            'GET /api/v1/mensajeria/accounts',
            'GET /api/v1/mensajeria/conversations?filter=24h&cursor=c%2F2&limit=20',
            'GET /api/v1/mensajeria/conversations/'.self::CONV,
            'POST /api/v1/mensajeria/conversations/'.self::CONV.'/read',
            'PATCH /api/v1/mensajeria/conversations/'.self::CONV.'/flags',
            'GET /api/v1/mensajeria/conversations/'.self::CONV.'/messages?before=cur',
            'GET /api/v1/mensajeria/operations/'.self::OP,
            'GET /api/v1/mensajeria/conversations/'.self::CONV.'/operations?state=uncertain',
            'POST /api/v1/mensajeria/chats',
            'GET /api/v1/mensajeria/conversations/..%2Flink%3Fx%3D1',
        ], $vistas);

        $c = $transport->calls;
        $this->assertSame(['return_to' => 'mensajes'], json_decode((string) $c[1]['body'], true));
        // Booleanos JSON de verdad y solo las banderas pedidas.
        $this->assertSame('{"archived":true,"pinned":false}', $c[7]['body']);
        $this->assertSame(['network' => 'telegram', 'identifier' => '@alguien'], json_decode((string) $c[11]['body'], true));
        foreach ([1, 6, 7, 11] as $i) {
            $this->assertArrayNotHasKey('idempotency-key', $c[$i]['headers']);
        }
    }

    public function test_el_envio_lleva_su_operation_id_como_idempotency_key(): void
    {
        [$client, $transport] = $this->client(static fn () => FakeTransport::json(['data' => ['operation' => ['state' => 'sent']]], 201));

        $client->mensajeria->sendText(self::CONV, self::OP, 'Hola');
        $client->mensajeria->sendText(self::CONV, self::OP, 'Hola');
        $client->mensajeria->sendFile(self::CONV, self::OP, '01J0000000000000000000000A', 'La obra');

        $c = $transport->calls;
        foreach ($c as $call) {
            $this->assertSame(self::BASE.'/api/v1/mensajeria/conversations/'.self::CONV.'/messages', $call['url']);
            $this->assertSame('POST', $call['method']);
            $this->assertSame(self::OP, $call['headers']['idempotency-key']);
        }
        $this->assertSame($c[0]['body'], $c[1]['body']);
        $this->assertSame(['operation_id' => self::OP, 'kind' => 'text', 'text' => 'Hola'], json_decode((string) $c[0]['body'], true));
        $this->assertSame(
            ['operation_id' => self::OP, 'kind' => 'file', 'attachment_id' => '01J0000000000000000000000A', 'text' => 'La obra'],
            json_decode((string) $c[2]['body'], true),
        );
    }

    public function test_sin_operation_id_el_envio_ni_sale(): void
    {
        [$client, $transport] = $this->client(static fn () => FakeTransport::json([]));

        try {
            $client->mensajeria->send(self::CONV, ['kind' => 'text', 'text' => 'Hola']);
            $this->fail('debía rechazar el envío sin operation_id');
        } catch (\InvalidArgumentException) {
        }
        try {
            $client->mensajeria->setFlags(self::CONV);
            $this->fail('debía rechazar flags vacíos');
        } catch (\InvalidArgumentException) {
        }
        $this->assertSame([], $transport->calls);
    }

    public function test_el_adjunto_sube_en_multipart_con_file_y_operation_id(): void
    {
        [$client, $transport] = $this->client(static fn () => FakeTransport::json(['data' => ['kind' => 'document']], 201));

        $client->mensajeria->uploadAttachment(self::CONV, self::OP, "%PDF\x00\xff", 'obra.pdf', 'application/pdf');

        $call = $transport->calls[0];
        $this->assertSame(self::BASE.'/api/v1/mensajeria/conversations/'.self::CONV.'/attachments', $call['url']);
        $this->assertMatchesRegularExpression('/^multipart\/form-data; boundary=pimia-[0-9a-f]+$/', $call['headers']['content-type']);
        $body = (string) $call['body'];
        $this->assertStringContainsString("name=\"operation_id\"\r\n\r\n".self::OP."\r\n", $body);
        $this->assertStringContainsString("name=\"file\"; filename=\"obra.pdf\"\r\nContent-Type: application/pdf\r\n\r\n%PDF\x00\xff\r\n", $body);
    }

    public function test_el_medio_vuelve_con_sus_bytes_exactos(): void
    {
        $bytes = "\x00\xff{\"n\":1}";
        [$client, $transport] = $this->client(
            static fn () => new Response(200, null, ['content-type' => 'application/octet-stream'], $bytes),
        );

        $this->assertSame($bytes, $client->mensajeria->media('7c2e9f10-1111-4222-8333-444455556666', 1));
        $this->assertSame(
            self::BASE.'/api/v1/mensajeria/messages/7c2e9f10-1111-4222-8333-444455556666/media?part=1',
            $transport->calls[0]['url'],
        );
    }

    public function test_el_codigo_de_la_mensajeria_se_reconoce_y_nada_mas(): void
    {
        $casos = [
            [409, 'messaging_link_revoked', 'messaging_link_revoked'],
            [403, 'module_not_installed', 'module_not_installed'],
            [404, 'operation_unknown', 'operation_unknown'],
            [422, 'idempotency_key_reused', 'idempotency_key_reused'],
            [402, 'wab_quota_exceeded', 'wab_quota_exceeded'],
            [409, 'draft_changed', null],
        ];
        foreach ($casos as [$status, $code, $esperado]) {
            [$client] = $this->client(static fn () => FakeTransport::json(['message' => 'x', 'code' => $code, 'error' => $code], $status));
            try {
                $client->mensajeria->link();
                $this->fail("{$status} {$code} debía lanzar");
            } catch (\Throwable $e) {
                $this->assertSame($esperado, Mensajeria::errorCode($e), "{$status} {$code}");
            }
        }
        $this->assertNull(Mensajeria::errorCode(new \RuntimeException('x')));
    }
}
