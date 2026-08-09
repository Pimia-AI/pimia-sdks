<?php

declare(strict_types=1);

namespace Pimia\Tests;

use PHPUnit\Framework\TestCase;
use Pimia\Config;
use Pimia\Exception\MissingScopeException;
use Pimia\Exception\NotAuthenticatedException;
use Pimia\Exception\RateLimitException;
use Pimia\Exception\UnauthorizedException;
use Pimia\Exception\ValidationException;
use Pimia\Http\Response;
use Pimia\OAuth\InMemoryTokenStore;
use Pimia\OAuth\TokenSet;
use Pimia\PimiaClient;

/**
 * Foco: lo que puede tumbar una integración de verdad — la rotación del
 * refresh y su persistencia — más el contrato de errores del api-guard.
 */
final class PimiaClientTest extends TestCase
{
    private const BASE = 'https://acme.pimia.es';

    public function test_manda_el_bearer_y_compone_la_url_con_api_v1(): void
    {
        [$client, $transport] = $this->client(
            static fn () => FakeTransport::json(['data' => []]),
            new TokenSet('at-1'),
        );

        $client->get('/invoices', ['page' => 2, 'vacio' => null]);

        $call = $transport->calls[0];
        $this->assertSame(self::BASE.'/api/v1/invoices?page=2', $call['url']);
        $this->assertSame('Bearer at-1', $call['headers']['authorization']);
    }

    public function test_acepta_el_path_con_y_sin_prefijo(): void
    {
        [$client, $transport] = $this->client(
            static fn () => FakeTransport::json([]),
            new TokenSet('at-1'),
        );

        $client->get('/api/v1/customers');
        $client->get('customers');

        $this->assertSame(self::BASE.'/api/v1/customers', $transport->calls[0]['url']);
        $this->assertSame(self::BASE.'/api/v1/customers', $transport->calls[1]['url']);
    }

    public function test_sin_tokens_no_llama_a_la_api(): void
    {
        [$client, $transport] = $this->client(static fn () => FakeTransport::json([]), null);

        $this->expectException(NotAuthenticatedException::class);

        try {
            $client->get('/invoices');
        } finally {
            $this->assertSame([], $transport->calls);
        }
    }

    public function test_refresca_si_esta_caducado_y_persiste_la_rotacion(): void
    {
        $store = new InMemoryTokenStore(new TokenSet('at-1', 'prt-1', time() - 10));

        [$client, $transport] = $this->clientWithStore(
            static fn (string $method, string $url) => str_contains($url, '/oauth/token')
                ? FakeTransport::json(['access_token' => 'at-2', 'refresh_token' => 'prt-2', 'expires_in' => 86400])
                : FakeTransport::json(['data' => []]),
            $store,
        );

        $client->get('/invoices');

        $this->assertStringContainsString('/oauth/token', $transport->calls[0]['url']);
        $this->assertStringContainsString('refresh_token=prt-1', (string) $transport->calls[0]['body']);
        $this->assertSame('Bearer at-2', $transport->calls[1]['headers']['authorization']);

        // Lo que evita el suicidio del grant: el refresh NUEVO queda guardado.
        $saved = $store->load();
        $this->assertNotNull($saved);
        $this->assertSame('prt-2', $saved->refreshToken);
        $this->assertSame('at-2', $saved->accessToken);
    }

    public function test_un_401_dispara_un_refresco_y_reintenta(): void
    {
        $apiCalls = 0;

        [$client, $transport] = $this->client(
            static function (string $method, string $url) use (&$apiCalls) {
                if (str_contains($url, '/oauth/token')) {
                    return FakeTransport::json(['access_token' => 'at-2', 'refresh_token' => 'prt-2', 'expires_in' => 86400]);
                }

                $apiCalls++;

                return $apiCalls === 1
                    ? FakeTransport::json(['message' => 'Unauthenticated.'], 401)
                    : FakeTransport::json(['data' => ['id' => 7]]);
            },
            new TokenSet('at-1', 'prt-1'),
        );

        $this->assertSame(['data' => ['id' => 7]], $client->get('/invoices/7'));
        $this->assertSame(2, $apiCalls);
        $this->assertCount(1, $transport->callsTo('/oauth/token'));
    }

    public function test_si_tras_refrescar_sigue_en_401_el_error_sube(): void
    {
        [$client, $transport] = $this->client(
            static fn (string $method, string $url) => str_contains($url, '/oauth/token')
                ? FakeTransport::json(['access_token' => 'at-2', 'refresh_token' => 'prt-2', 'expires_in' => 86400])
                : FakeTransport::json(['message' => 'Unauthenticated.'], 401),
            new TokenSet('at-1', 'prt-1'),
        );

        try {
            $client->get('/invoices');
            $this->fail('esperaba UnauthorizedException');
        } catch (UnauthorizedException) {
            // Un solo refresco: no entra en bucle.
            $this->assertCount(1, $transport->callsTo('/oauth/token'));
        }
    }

    public function test_si_el_usuario_revoco_la_app_el_error_es_unauthorized_no_oauth(): void
    {
        // Escenario REAL del e2e contra dev: revocado el grant, ni el access ni
        // el refresh valen. Quien llama debe recibir UnauthorizedException
        // («re-autoriza»), no el OAuthException del token endpoint.
        [$client] = $this->client(
            static fn (string $method, string $url) => str_contains($url, '/oauth/token')
                ? FakeTransport::json(['error' => 'invalid_grant'], 400)
                : FakeTransport::json(['message' => 'Unauthenticated.'], 401),
            new TokenSet('at-1', 'prt-revocado'),
        );

        try {
            $client->get('/invoices');
            $this->fail('esperaba UnauthorizedException');
        } catch (UnauthorizedException $e) {
            $this->assertStringContainsString('vuelve a pedir autorización', $e->getMessage());
            // La causa original queda en la cadena para diagnosticar.
            $this->assertInstanceOf(\Pimia\Exception\OAuthException::class, $e->getPrevious());
            $this->assertSame('invalid_grant', $e->getPrevious()->error);
        }
    }

    public function test_un_refresco_proactivo_fallido_tambien_es_unauthorized(): void
    {
        [$client] = $this->client(
            static fn (string $method, string $url) => str_contains($url, '/oauth/token')
                ? FakeTransport::json(['error' => 'invalid_grant'], 400)
                : FakeTransport::json([]),
            new TokenSet('at-1', 'prt-revocado', time() - 10),
        );

        $this->expectException(UnauthorizedException::class);
        $client->get('/invoices');
    }

    public function test_sin_refresh_token_y_access_caducado_no_inventa_nada(): void
    {
        [$client] = $this->client(
            static fn () => FakeTransport::json([]),
            new TokenSet('at-1', null, time() - 10),
        );

        $this->expectException(UnauthorizedException::class);
        $client->get('/invoices');
    }

    public function test_un_403_del_api_guard_trae_el_scope_exacto(): void
    {
        [$client] = $this->client(
            static fn () => FakeTransport::json(['message' => 'Token lacks the invoices:write scope'], 403),
            new TokenSet('at-1'),
        );

        try {
            $client->post('/invoices', ['total' => 100]);
            $this->fail('esperaba MissingScopeException');
        } catch (MissingScopeException $e) {
            $this->assertSame('invoices:write', $e->scope);
            $this->assertSame(403, $e->status);
        }
    }

    public function test_un_422_expone_los_errores_por_campo(): void
    {
        [$client] = $this->client(
            static fn () => FakeTransport::json([
                'message' => 'The given data was invalid.',
                'errors' => ['customer_id' => ['requerido']],
            ], 422),
            new TokenSet('at-1'),
        );

        try {
            $client->post('/invoices', []);
            $this->fail('esperaba ValidationException');
        } catch (ValidationException $e) {
            $this->assertSame(['customer_id' => ['requerido']], $e->errors());
        }
    }

    public function test_reintenta_un_429_respetando_retry_after(): void
    {
        $attempts = 0;
        $slept = [];

        [$client] = $this->client(
            static function () use (&$attempts) {
                $attempts++;

                return $attempts === 1
                    ? FakeTransport::json(['message' => 'Too Many Attempts.'], 429, ['retry-after' => '1'])
                    : FakeTransport::json(['data' => []]);
            },
            new TokenSet('at-1'),
            sleeper: static function (int $seconds) use (&$slept) { $slept[] = $seconds; },
        );

        $this->assertSame(['data' => []], $client->get('/invoices'));
        $this->assertSame(2, $attempts);
        $this->assertSame([1], $slept);
    }

    public function test_agotados_los_reintentos_lanza_rate_limit_con_retry_after(): void
    {
        [$client] = $this->client(
            static fn () => FakeTransport::json(['message' => 'Too Many Attempts.'], 429, ['retry-after' => '7']),
            new TokenSet('at-1'),
            config: ['maxRateLimitRetries' => 1],
            sleeper: static function (int $seconds) {},
        );

        try {
            $client->get('/invoices');
            $this->fail('esperaba RateLimitException');
        } catch (RateLimitException $e) {
            $this->assertSame(7, $e->retryAfter);
        }
    }

    public function test_expone_las_cabeceras_de_rate_limit(): void
    {
        [$client] = $this->client(
            static fn () => FakeTransport::json(['data' => []], 200, [
                'x-ratelimit-limit' => '300',
                'x-ratelimit-remaining' => '297',
            ]),
            new TokenSet('at-1'),
        );

        $client->get('/invoices');

        $this->assertSame(['limit' => 300, 'remaining' => 297], $client->rateLimit());
    }

    public function test_los_helpers_de_dominio_pegan_en_las_rutas_correctas(): void
    {
        [$client, $transport] = $this->client(
            static fn () => FakeTransport::json([]),
            new TokenSet('at-1'),
        );

        $client->invoices->list(['page' => 1]);
        $client->invoices->get(42);
        $client->customers->create(['name' => 'ACME']);

        $this->assertSame(self::BASE.'/api/v1/invoices?page=1', $transport->calls[0]['url']);
        $this->assertSame(self::BASE.'/api/v1/invoices/42', $transport->calls[1]['url']);
        $this->assertSame('POST', $transport->calls[2]['method']);
        $this->assertSame('application/json', $transport->calls[2]['headers']['content-type']);
    }

    public function test_una_respuesta_sin_cuerpo_no_revienta(): void
    {
        [$client] = $this->client(
            static fn () => new Response(204, null),
            new TokenSet('at-1'),
        );

        $this->assertNull($client->delete('/invoices/1'));
    }


    // ── Idempotencia ──────────────────────────────────────────────────────
    //
    // El contrato dice que un reintento devuelve la MISMA respuesta que la
    // primera llamada. Por eso el cuerpo solo no basta para saber si Pimia
    // escribio o se limito a repetirse, y de ahi requestWithMeta().

    public function test_la_clave_de_idempotencia_viaja_como_cabecera(): void
    {
        [$client, $transport] = $this->client(
            static fn () => FakeTransport::json(['data' => ['id' => 60]], 201),
            new TokenSet('at-1'),
        );

        $client->estimates->create(['total' => 45050], 'deal-abc');

        $this->assertSame('deal-abc', $transport->calls[0]['headers']['idempotency-key']);
    }

    public function test_sin_clave_no_se_manda_la_cabecera(): void
    {
        [$client, $transport] = $this->client(
            static fn () => FakeTransport::json(['data' => []], 201),
            new TokenSet('at-1'),
        );

        $client->estimates->create(['total' => 1]);

        $this->assertArrayNotHasKey('idempotency-key', $transport->calls[0]['headers']);
    }

    public function test_request_with_meta_distingue_la_escritura_real_del_eco(): void
    {
        $respuesta = ['data' => ['id' => 60, 'estimate_number' => 'PRE-000029']];

        [$client] = $this->client(
            static fn (string $m, string $u, int $n) => $n === 1
                ? FakeTransport::json($respuesta, 201)
                : FakeTransport::json($respuesta, 201, ['idempotency-replayed' => 'true']),
            new TokenSet('at-1'),
        );

        $primera = $client->requestWithMeta('POST', '/estimates', body: ['total' => 45050], idempotencyKey: 'deal-abc');
        $reintento = $client->requestWithMeta('POST', '/estimates', body: ['total' => 45050], idempotencyKey: 'deal-abc');

        // El cuerpo es identico: ESE es el contrato, y por eso no sirve para
        // distinguirlas.
        $this->assertSame($primera->data, $reintento->data);

        $this->assertFalse($primera->meta->idempotentReplay);
        $this->assertTrue($reintento->meta->idempotentReplay);
        $this->assertSame(201, $reintento->meta->status);
    }

    public function test_request_with_meta_trae_estado_request_id_y_rate_limit(): void
    {
        [$client] = $this->client(
            static fn () => FakeTransport::json(['data' => []], 200, [
                'x-request-id' => 'req-42',
                'x-ratelimit-limit' => '300',
                'x-ratelimit-remaining' => '299',
            ]),
            new TokenSet('at-1'),
        );

        $meta = $client->requestWithMeta('GET', '/customers')->meta;

        $this->assertSame(200, $meta->status);
        $this->assertSame('req-42', $meta->requestId);
        $this->assertSame(['limit' => 300, 'remaining' => 299], $meta->rateLimit);
        $this->assertFalse($meta->idempotentReplay);
    }

    public function test_request_sigue_devolviendo_solo_el_cuerpo(): void
    {
        [$client] = $this->client(
            static fn () => FakeTransport::json(['data' => ['id' => 7]]),
            new TokenSet('at-1'),
        );

        $this->assertSame(['data' => ['id' => 7]], $client->get('/customers/7'));
    }

    /**
     * @param  array<string, mixed>  $config
     * @return array{PimiaClient, FakeTransport}
     */
    private function client(
        \Closure $handler,
        ?TokenSet $tokens,
        array $config = [],
        ?\Closure $sleeper = null,
    ): array {
        return $this->clientWithStore($handler, new InMemoryTokenStore($tokens), $config, $sleeper);
    }

    /**
     * @param  array<string, mixed>  $config
     * @return array{PimiaClient, FakeTransport}
     */
    private function clientWithStore(
        \Closure $handler,
        InMemoryTokenStore $store,
        array $config = [],
        ?\Closure $sleeper = null,
    ): array {
        $transport = new FakeTransport($handler);

        $client = new PimiaClient(
            new Config(
                baseUrl: self::BASE.'/',
                clientId: 'mcp_test',
                clientSecret: 'pcs_test',
                redirectUri: 'https://partner.example/cb',
                maxRateLimitRetries: $config['maxRateLimitRetries'] ?? 2,
            ),
            $transport,
            $store,
            $sleeper ?? static function (int $seconds) {},
        );

        return [$client, $transport];
    }
}
