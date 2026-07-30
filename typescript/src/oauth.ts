/**
 * Ceremonia OAuth 2.0 contra el Authorization Server de Pimia.
 *
 * Un tenant = un servidor de autorización (`https://{tenant}.pimia.es`), y un
 * token vale solo para ese tenant (modelo un-token-por-tienda). Todo lo que
 * hay aquí es de la parte «servidor» de tu app salvo `createPkceChallenge` y
 * `buildAuthorizeUrl`, que también valen en el navegador.
 */

import { OAuthError } from './errors.js'
import { type TokenSet, tokenSetFromResponse } from './tokens.js'

export interface OAuthConfig {
  /** Base del tenant, con o sin barra final: `https://acme.pimia.es`. */
  baseUrl: string
  clientId: string
  /** Solo clients confidenciales (app server-side). Nunca en el navegador. */
  clientSecret?: string
  redirectUri: string
  fetch?: typeof globalThis.fetch
}

export interface PkceChallenge {
  verifier: string
  challenge: string
  method: 'S256'
}

export interface AuthorizeUrlOptions {
  /** Scopes granulares: `['invoices:read', 'customers:read']`. Pide lo mínimo. */
  scopes: string[]
  state: string
  pkce: PkceChallenge
}

/** Metadata del AS (RFC 8414). */
export interface AuthorizationServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  revocation_endpoint?: string
  scopes_supported?: string[]
  grant_types_supported?: string[]
}

export class OAuth {
  private readonly baseUrl: string
  private readonly doFetch: typeof globalThis.fetch

  constructor(private readonly config: OAuthConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.doFetch = config.fetch ?? globalThis.fetch
  }

  /** `GET /.well-known/oauth-authorization-server` — útil para no cablear rutas. */
  async metadata(): Promise<AuthorizationServerMetadata> {
    const response = await this.doFetch(`${this.baseUrl}/.well-known/oauth-authorization-server`, {
      headers: { accept: 'application/json' },
    })

    if (!response.ok) {
      throw new OAuthError('metadata_unavailable', `HTTP ${response.status}`)
    }

    return (await response.json()) as AuthorizationServerMetadata
  }

  /**
   * URL a la que mandas al usuario. Verás la pantalla de consentimiento de
   * Pimia con los permisos de los scopes que pidas.
   */
  buildAuthorizeUrl({ scopes, state, pkce }: AuthorizeUrlOptions): string {
    const query = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: pkce.method,
    })

    return `${this.baseUrl}/oauth/authorize?${query.toString()}`
  }

  /**
   * Canje del `code` del callback. El código dura 10 minutos y un solo uso.
   *
   * Acepta el challenge completo o solo `{ verifier }`: en un flujo real el
   * verifier se recupera de la sesión del usuario y el challenge ya no hace
   * falta (lo tiene el servidor, que lo comparará con el hash del verifier).
   */
  async exchangeCode(code: string, pkce: Pick<PkceChallenge, 'verifier'>): Promise<TokenSet> {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: pkce.verifier,
    })
  }

  /**
   * Refresco CON ROTACIÓN: el refresh que pasas queda invalidado y el TokenSet
   * devuelto trae uno nuevo. Persístelo antes de volver a llamar a la API (ver
   * tokens.ts) — reusar el viejo revoca el grant entero.
   */
  async refresh(refreshToken: string): Promise<TokenSet> {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
  }

  /**
   * Revocación RFC 7009. Con un refresh token cae el grant ENTERO (todos los
   * access tokens de tu app para ese usuario); con un access token, solo ese.
   * Llámalo cuando el usuario desconecte tu app: es la cortesía mínima.
   */
  async revoke(token: string): Promise<void> {
    const response = await this.doFetch(`${this.baseUrl}/oauth/revoke`, {
      method: 'POST',
      headers: this.formHeaders(),
      body: this.formBody({ token }),
    })

    // 200 aunque el token no exista (el AS no filtra si existía).
    if (!response.ok) {
      const body = await safeJson(response)
      throw new OAuthError(
        (body as { error?: string })?.error ?? 'revocation_failed',
        (body as { error_description?: string })?.error_description ?? `HTTP ${response.status}`,
      )
    }
  }

  private async tokenRequest(params: Record<string, string>): Promise<TokenSet> {
    const response = await this.doFetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: this.formHeaders(),
      body: this.formBody(params),
    })

    const body = await safeJson(response)

    if (!response.ok) {
      const error = body as { error?: string; error_description?: string } | null
      throw new OAuthError(error?.error ?? 'token_request_failed', error?.error_description)
    }

    return tokenSetFromResponse(body as Parameters<typeof tokenSetFromResponse>[0])
  }

  private formHeaders(): Record<string, string> {
    return {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    }
  }

  private formBody(params: Record<string, string>): string {
    const body = new URLSearchParams({ ...params, client_id: this.config.clientId })

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret)
    }

    return body.toString()
  }
}

/**
 * PKCE S256. Obligatorio para clients públicos y recomendable siempre: liga el
 * código de autorización a quien lo pidió. Guarda el `verifier` en la sesión
 * del usuario hasta que vuelva del callback.
 */
export async function createPkceChallenge(): Promise<PkceChallenge> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const verifier = base64Url(bytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))

  return { verifier, challenge: base64Url(new Uint8Array(digest)), method: 'S256' }
}

/** `state` anti-CSRF. Compáralo al volver del callback. */
export function createState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
