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

import { PimiaError } from './errors.js'

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

/**
 * El «store» de un token que NO es tuyo.
 *
 * ── Para qué existe ─────────────────────────────────────────────────────────
 *
 * Hay integraciones que no poseen ningún grant y **no deben poseerlo**: un
 * servicio al que el front le manda, en cada petición, el `Authorization` del
 * usuario que ha entrado en Pimia, y que lo reenvía tal cual. La consecuencia
 * buena es que Pimia sigue decidiendo los permisos: ese servicio no puede darle
 * a nadie más de lo que su token ya le daba, y no hay una credencial propia que
 * auditar aparte.
 *
 * Un token prestado **no trae refresh** —el refresh es del dueño del grant— y
 * dura lo que dure la petición. Eso hace que todo lo que este SDK protege del
 * {@link TokenStore} de verdad no aplique aquí: no hay rotación que persistir,
 * ni reuse que evitar, ni candado por usuario que sostener.
 *
 * ── Por qué `save()` REVIENTA en vez de callar ──────────────────────────────
 *
 * Porque llegar ahí significaría que el cliente ha creído refrescar un token
 * ajeno. Hoy no puede pasar por construcción —sin `refreshToken` el 401 sube
 * tal cual en vez de disparar un refresco—, y justo por eso el día que alguien
 * cambie ese camino conviene que se entere aquí, con el nombre de la clase
 * dentro, y no en producción como un grant de otro revocado en cascada.
 *
 * No se construye a mano: sale de `PimiaClient.withBorrowedToken()`.
 */
export class BorrowedTokenStore implements TokenStore {
  constructor(private readonly accessToken: string) {}

  load(): TokenSet {
    /* Sin `refreshToken` y sin `expiresAt`: los dos son del dueño del grant.
       Sin expiración el cliente no intenta refrescar por su cuenta, y sin
       refresh un 401 sube tal cual — que es lo correcto: quien tiene que
       conseguir otro token es quien te prestó éste. */
    return { accessToken: this.accessToken }
  }

  save(): void {
    throw new PimiaError(
      'Este cliente usa un token prestado: no hay grant propio que rotar ni nada que ' +
        'persistir. Si has llegado aquí, alguien ha intentado refrescar el token de otro.',
    )
  }

  /**
   * No-op, y no es pereza: no hay nada que borrar. El token vive en la petición
   * que lo trajo y muere con ella.
   */
  clear(): void {}
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
