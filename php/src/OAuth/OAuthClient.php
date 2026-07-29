<?php

declare(strict_types=1);

namespace Pimia\OAuth;

use Pimia\Config;
use Pimia\Exception\OAuthException;
use Pimia\Http\Transport;

/**
 * Ceremonia OAuth 2.0 contra el Authorization Server de Pimia.
 *
 * Un tenant = un servidor de autorización (`https://{tenant}.pimia.es`) y un
 * token vale solo para ese tenant (modelo un-token-por-tienda).
 */
final class OAuthClient
{
    public function __construct(
        private readonly Config $config,
        private readonly Transport $transport,
    ) {
    }

    /**
     * Metadata del AS (RFC 8414): útil para no cablear rutas.
     *
     * @return array<string, mixed>
     */
    public function metadata(): array
    {
        $response = $this->transport->send(
            'GET',
            $this->config->baseUrl.'/.well-known/oauth-authorization-server',
            ['accept' => 'application/json'],
        );

        if ($response->status >= 400) {
            throw new OAuthException('metadata_unavailable', "HTTP {$response->status}");
        }

        return is_array($response->body) ? $response->body : [];
    }

    /**
     * URL a la que mandas al usuario: verá la pantalla de consentimiento de
     * Pimia con los permisos de los scopes que pidas.
     *
     * @param  list<string>  $scopes
     */
    public function authorizeUrl(array $scopes, string $state, PkceChallenge $pkce): string
    {
        $query = http_build_query([
            'client_id' => $this->config->clientId,
            'redirect_uri' => $this->config->redirectUri,
            'response_type' => 'code',
            'scope' => implode(' ', $scopes),
            'state' => $state,
            'code_challenge' => $pkce->challenge,
            'code_challenge_method' => PkceChallenge::METHOD,
        ]);

        return $this->config->baseUrl.'/oauth/authorize?'.$query;
    }

    /** Canje del `code` del callback. Dura 10 minutos y un solo uso. */
    public function exchangeCode(string $code, PkceChallenge $pkce): TokenSet
    {
        return $this->tokenRequest([
            'grant_type' => 'authorization_code',
            'code' => $code,
            'redirect_uri' => $this->config->redirectUri,
            'code_verifier' => $pkce->verifier,
        ]);
    }

    /**
     * Refresco CON ROTACIÓN: el refresh que pasas queda invalidado y el
     * TokenSet devuelto trae uno nuevo. Persístelo antes de volver a llamar a
     * la API — reusar el viejo revoca el grant entero (ver TokenStore).
     */
    public function refresh(string $refreshToken): TokenSet
    {
        return $this->tokenRequest([
            'grant_type' => 'refresh_token',
            'refresh_token' => $refreshToken,
        ]);
    }

    /**
     * Revocación RFC 7009. Con un refresh token cae el grant ENTERO (todos los
     * access tokens de tu app para ese usuario); con un access token, solo ese.
     * Llámalo cuando el usuario desconecte tu app.
     */
    public function revoke(string $token): void
    {
        $response = $this->transport->send(
            'POST',
            $this->config->baseUrl.'/oauth/revoke',
            $this->formHeaders(),
            $this->formBody(['token' => $token]),
        );

        // 200 aunque el token no exista (el AS no filtra si existía).
        if ($response->status >= 400) {
            $body = is_array($response->body) ? $response->body : [];
            throw new OAuthException(
                (string) ($body['error'] ?? 'revocation_failed'),
                (string) ($body['error_description'] ?? "HTTP {$response->status}"),
            );
        }
    }

    /** @param array<string, string> $params */
    private function tokenRequest(array $params): TokenSet
    {
        $response = $this->transport->send(
            'POST',
            $this->config->baseUrl.'/oauth/token',
            $this->formHeaders(),
            $this->formBody($params),
        );

        $body = is_array($response->body) ? $response->body : [];

        if ($response->status >= 400) {
            throw new OAuthException(
                (string) ($body['error'] ?? 'token_request_failed'),
                isset($body['error_description']) ? (string) $body['error_description'] : null,
            );
        }

        if (! isset($body['access_token'])) {
            throw new OAuthException('token_request_failed', 'La respuesta no trae access_token');
        }

        return TokenSet::fromResponse($body);
    }

    /** @return array<string, string> */
    private function formHeaders(): array
    {
        return [
            'content-type' => 'application/x-www-form-urlencoded',
            'accept' => 'application/json',
        ];
    }

    /** @param array<string, string> $params */
    private function formBody(array $params): string
    {
        $params['client_id'] = $this->config->clientId;

        if ($this->config->clientSecret !== null) {
            $params['client_secret'] = $this->config->clientSecret;
        }

        return http_build_query($params);
    }
}
