/**
 * Tokens y su persistencia.
 *
 * ⚠️ LO MÁS IMPORTANTE DE ESTE SDK. El refresh token de Pimia **rota**: cada
 * canje devuelve uno nuevo y mata el anterior, y **reusar uno ya rotado se
 * trata como robo: revoca el grant entero en cascada** (todos los tokens de tu
 * app para ese usuario mueren y el usuario tiene que volver a autorizarte).
 *
 * Por eso el SDK nunca guarda tokens «en una variable y ya»: exige un
 * TokenStore y persiste el conjunto ENTERO tras cada refresh. Si tu app corre
 * en varios procesos, el store debe ser compartido (Redis, BD…) y, si dos
 * procesos pueden refrescar a la vez, serializa el refresh — dos refrescos
 * concurrentes con el mismo token son, para el servidor, un reuse.
 */

export interface TokenSet {
  accessToken: string
  /** Ausente si el operador desactivó los refresh (OAUTH_ACCESS_TOKEN_TTL=0). */
  refreshToken?: string
  /** Epoch en ms. Ausente = el servidor no dio expiración. */
  expiresAt?: number
  scope?: string
  tokenType?: string
}

export interface TokenStore {
  load(): Promise<TokenSet | null> | TokenSet | null
  save(tokens: TokenSet): Promise<void> | void
  clear(): Promise<void> | void
}

/** Store de memoria: vale para scripts y tests, NO para producción con varios procesos. */
export class MemoryTokenStore implements TokenStore {
  constructor(private tokens: TokenSet | null = null) {}

  load(): TokenSet | null {
    return this.tokens
  }

  save(tokens: TokenSet): void {
    this.tokens = tokens
  }

  clear(): void {
    this.tokens = null
  }
}

/** ¿Caduca dentro de `skewSeconds`? Sin expiresAt se asume que sigue vivo. */
export function isExpired(tokens: TokenSet, skewSeconds = 60, now = Date.now()): boolean {
  if (tokens.expiresAt === undefined) return false
  return tokens.expiresAt - skewSeconds * 1000 <= now
}

/** Respuesta cruda del token endpoint → TokenSet. */
export function tokenSetFromResponse(
  payload: {
    access_token: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    token_type?: string
  },
  now = Date.now(),
): TokenSet {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: payload.expires_in ? now + payload.expires_in * 1000 : undefined,
    scope: payload.scope,
    tokenType: payload.token_type ?? 'bearer',
  }
}
