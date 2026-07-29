<?php

declare(strict_types=1);

namespace Pimia\Tests;

use PHPUnit\Framework\TestCase;
use Pimia\Config;
use Pimia\Exception\OAuthException;
use Pimia\Http\Response;
use Pimia\OAuth\OAuthClient;
use Pimia\OAuth\PkceChallenge;

/** Ceremonia OAuth: PKCE, URL de authorize, canje, refresco y revocación. */
final class OAuthClientTest extends TestCase
{
    private const BASE = 'https://acme.pimia.es';

    public function test_el_challenge_pkce_es_el_sha256_base64url_del_verifier(): void
    {
        $pkce = PkceChallenge::create();

        $expected = rtrim(strtr(base64_encode(hash('sha256', $pkce->verifier, true)), '+/', '-_'), '=');

        $this->assertSame($expected, $pkce->challenge);
        $this->assertSame('S256', PkceChallenge::METHOD);
        $this->assertGreaterThanOrEqual(43, strlen($pkce->verifier)); // mínimo RFC 7636
        $this->assertDoesNotMatchRegularExpression('/[+\/=]/', $pkce->challenge);
    }

    public function test_el_challenge_se_rehidrata_desde_el_verifier(): void
    {
        $original = PkceChallenge::create();
        $rehydrated = PkceChallenge::fromVerifier($original->verifier);

        $this->assertSame($original->challenge, $rehydrated->challenge);
    }

    public function test_dos_challenges_y_dos_states_no_se_repiten(): void
    {
        $this->assertNotSame(PkceChallenge::create()->verifier, PkceChallenge::create()->verifier);
        $this->assertNotSame(PkceChallenge::state(), PkceChallenge::state());
    }

    public function test_la_url_de_authorize_lleva_todo_y_normaliza_la_base(): void
    {
        [$oauth] = $this->oauth(static fn () => FakeTransport::json([]));
        $pkce = PkceChallenge::create();

        $url = $oauth->authorizeUrl(['invoices:read', 'customers:read'], 'st4te', $pkce);

        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $this->assertStringStartsWith(self::BASE.'/oauth/authorize?', $url);
        $this->assertSame('mcp_test', $query['client_id']);
        $this->assertSame('code', $query['response_type']);
        $this->assertSame('invoices:read customers:read', $query['scope']);
        $this->assertSame('st4te', $query['state']);
        $this->assertSame($pkce->challenge, $query['code_challenge']);
        $this->assertSame('S256', $query['code_challenge_method']);
    }

    public function test_el_canje_manda_verifier_y_el_secret_del_client_confidencial(): void
    {
        [$oauth, $transport] = $this->oauth(static fn () => FakeTransport::json([
            'access_token' => 'at-1',
            'refresh_token' => 'prt-1',
            'expires_in' => 86400,
            'scope' => 'invoices:read',
            'token_type' => 'bearer',
        ]));

        $pkce = PkceChallenge::create();
        $before = time();
        $tokens = $oauth->exchangeCode('c0de', $pkce);

        parse_str((string) $transport->calls[0]['body'], $body);
        $this->assertSame(self::BASE.'/oauth/token', $transport->calls[0]['url']);
        $this->assertSame('authorization_code', $body['grant_type']);
        $this->assertSame('c0de', $body['code']);
        $this->assertSame($pkce->verifier, $body['code_verifier']);
        $this->assertSame('pcs_test', $body['client_secret']);

        $this->assertSame('at-1', $tokens->accessToken);
        $this->assertSame('prt-1', $tokens->refreshToken);
        $this->assertGreaterThanOrEqual($before + 86400, (int) $tokens->expiresAt);
        $this->assertSame(['invoices:read'], $tokens->scopes());
    }

    public function test_un_error_del_token_endpoint_llega_tipado(): void
    {
        [$oauth] = $this->oauth(static fn () => FakeTransport::json([
            'error' => 'invalid_client',
            'error_description' => 'Client authentication failed',
        ], 401));

        try {
            $oauth->refresh('prt-1');
            $this->fail('esperaba OAuthException');
        } catch (OAuthException $e) {
            $this->assertSame('invalid_client', $e->error);
            $this->assertStringContainsString('Client authentication failed', $e->getMessage());
        }
    }

    public function test_sin_refresh_token_en_la_respuesta_no_inventa_uno(): void
    {
        [$oauth] = $this->oauth(static fn () => FakeTransport::json([
            'access_token' => 'at-1',
            'token_type' => 'bearer',
        ]));

        $tokens = $oauth->exchangeCode('c0de', PkceChallenge::create());

        $this->assertNull($tokens->refreshToken);
        $this->assertNull($tokens->expiresAt);
        $this->assertFalse($tokens->isExpired());
    }

    public function test_revoke_usa_rfc7009_y_tolera_el_200_mudo(): void
    {
        [$oauth, $transport] = $this->oauth(static fn () => new Response(200, null));

        $oauth->revoke('prt-1');

        parse_str((string) $transport->calls[0]['body'], $body);
        $this->assertSame(self::BASE.'/oauth/revoke', $transport->calls[0]['url']);
        $this->assertSame('prt-1', $body['token']);
        $this->assertSame('mcp_test', $body['client_id']);
    }

    public function test_la_metadata_se_lee_del_well_known(): void
    {
        [$oauth, $transport] = $this->oauth(static fn () => FakeTransport::json([
            'issuer' => self::BASE,
            'revocation_endpoint' => self::BASE.'/oauth/revoke',
        ]));

        $metadata = $oauth->metadata();

        $this->assertSame(self::BASE.'/.well-known/oauth-authorization-server', $transport->calls[0]['url']);
        $this->assertSame(self::BASE.'/oauth/revoke', $metadata['revocation_endpoint']);
    }

    /** @return array{OAuthClient, FakeTransport} */
    private function oauth(\Closure $handler): array
    {
        $transport = new FakeTransport($handler);

        $oauth = new OAuthClient(
            new Config(
                baseUrl: self::BASE.'/', // con barra: debe normalizarse
                clientId: 'mcp_test',
                clientSecret: 'pcs_test',
                redirectUri: 'https://partner.example/cb',
            ),
            $transport,
        );

        return [$oauth, $transport];
    }
}
