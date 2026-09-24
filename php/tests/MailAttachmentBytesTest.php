<?php

declare(strict_types=1);

namespace Pimia\Tests;

use GuzzleHttp\Client as Guzzle;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\HttpFactory;
use GuzzleHttp\Psr7\Response as PsrResponse;
use PHPUnit\Framework\TestCase;
use Pimia\Config;
use Pimia\Exception\ApiException;
use Pimia\Exception\NotFoundException;
use Pimia\Http\PsrTransport;
use Pimia\OAuth\InMemoryTokenStore;
use Pimia\OAuth\TokenSet;
use Pimia\PimiaClient;
use Pimia\Resource\Mail;

/**
 * El adjunto de un correo vuelve con SUS BYTES, sea cual sea su tipo
 * (revisión de Astra sobre #139). Va por el transporte PSR-18 DE VERDAD
 * (Guzzle con un MockHandler) y no por el FakeTransport, porque el fallo
 * estaba justo en el decodificador del transporte: un adjunto `.json`, uno
 * `+json` o uno vacío salían como array o como `null`.
 */
final class MailAttachmentBytesTest extends TestCase
{
    private const BASE = 'https://acme.pimia.es';

    private const PATH = '/api/v1/mail/mailboxes/mb_1/attachments/att_1';

    /** @param  list<PsrResponse>  $responses */
    private function client(array $responses): PimiaClient
    {
        $factory = new HttpFactory();
        $guzzle = new Guzzle(['handler' => HandlerStack::create(new MockHandler($responses)), 'http_errors' => false]);

        return new PimiaClient(
            new Config(
                baseUrl: self::BASE,
                clientId: 'mcp_test',
                clientSecret: 'pcs_test',
                redirectUri: 'https://partner.example/cb',
            ),
            new PsrTransport($guzzle, $factory, $factory),
            new InMemoryTokenStore(new TokenSet('at-1')),
        );
    }

    /** @return iterable<string, array{string, string}> */
    public static function bytes(): iterable
    {
        yield 'un .json' => ["{ \"n\": 1 }\n", 'application/json'];
        yield 'un +json' => ['{"@context":"x"}', 'application/ld+json'];
        yield 'un fichero vacío' => ['', 'application/octet-stream'];
        yield 'un json vacío' => ['', 'application/json'];
        yield 'un PDF (control)' => ["%PDF-1.7\n\x00\xff\xfe binario", 'application/pdf'];
        yield 'binario sin tipo (control)' => ["\x00\x01\x02\xff", ''];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('bytes')]
    public function test_el_adjunto_vuelve_con_sus_bytes_exactos(string $bytes, string $type): void
    {
        $headers = $type === '' ? [] : ['Content-Type' => $type];
        $client = $this->client([new PsrResponse(200, $headers, $bytes)]);

        $this->assertSame($bytes, $client->mail->attachment('mb_1', 'att_1'));
    }

    public function test_un_error_sigue_siendo_su_excepcion_con_su_codigo(): void
    {
        $client = $this->client([
            new PsrResponse(502, ['Content-Type' => 'application/json'], json_encode(['message' => 'x', 'code' => 'attachment_incomplete', 'error' => 'attachment_incomplete'])),
            new PsrResponse(404, ['Content-Type' => 'application/json'], json_encode(['message' => 'No existe'])),
            new PsrResponse(402, ['Content-Type' => 'application/json'], json_encode(['message' => 'x', 'error' => 'tenant_suspended'])),
        ]);

        $errores = [];
        for ($i = 0; $i < 3; $i++) {
            try {
                $client->mail->attachment('mb_1', 'att_1');
                $this->fail('un error debía lanzar');
            } catch (ApiException $e) {
                $errores[] = $e;
            }
        }

        $this->assertSame(502, $errores[0]->status);
        $this->assertSame('attachment_incomplete', $errores[0]->body['code']);
        $this->assertNull(Mail::accessClosure($errores[0]), 'un 502 no cierra nada');
        $this->assertInstanceOf(NotFoundException::class, $errores[1]);
        $this->assertSame('module_disabled', Mail::accessClosure($errores[2]), 'un 402 cierra el módulo');
    }

    public function test_request_sigue_decodificando_json_para_lo_demas(): void
    {
        $client = $this->client([new PsrResponse(200, ['Content-Type' => 'application/json'], '{"data":[]}')]);

        $this->assertSame(['data' => []], $client->mail->mailboxes());
    }

    public function test_pide_cualquier_tipo_y_va_a_su_ruta(): void
    {
        $history = [];
        $factory = new HttpFactory();
        $stack = HandlerStack::create(new MockHandler([new PsrResponse(200, [], 'x')]));
        $stack->push(\GuzzleHttp\Middleware::history($history));
        $client = new PimiaClient(
            new Config(baseUrl: self::BASE, clientId: 'mcp_test', clientSecret: 'pcs_test', redirectUri: 'https://partner.example/cb'),
            new PsrTransport(new Guzzle(['handler' => $stack, 'http_errors' => false]), $factory, $factory),
            new InMemoryTokenStore(new TokenSet('at-1')),
        );

        $client->mail->attachment('mb_1', 'att_1');

        $this->assertSame(self::BASE.self::PATH, (string) $history[0]['request']->getUri());
        $this->assertSame('*/*', $history[0]['request']->getHeaderLine('accept'));
    }
}
