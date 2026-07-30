/**
 * Dónde viven los tokens de Pimia de cada usuario.
 *
 * ⚠️ ESTA ES LA PIEZA QUE HAY QUE SUSTITUIR. Aquí se guardan en un fichero
 * JSON para que el starter arranque sin base de datos. En tu app: una tabla
 * (`sid` o tu user_id como clave) y el TokenSet como columnas o JSON.
 *
 * Lo que NO puedes cambiar, gobierne lo que gobierne tu almacenamiento:
 *
 *  1. **Persistir el TokenSet entero en cada refresco.** El refresh de Pimia
 *     ROTA: el viejo muere al usarse. Si guardas solo el access token, el
 *     siguiente refresco usará un refresh ya rotado y Pimia lo tratará como
 *     robo → revoca el grant entero y tu usuario tiene que volver a
 *     autorizarte.
 *  2. **Un solo refresco a la vez por usuario.** El SDK lo serializa dentro
 *     del proceso; si corres varias instancias, necesitas un lock en tu BD
 *     (p. ej. `SELECT … FOR UPDATE` sobre la fila del usuario).
 */

import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { TokenSet, TokenStore } from '@pimia/sdk'

const DATA_DIR = process.env.PIMIA_TOKEN_DIR ?? join(process.cwd(), '.tokens')

/** TokenStore de fichero, uno por sesión. Solo para desarrollo. */
export class FileTokenStore implements TokenStore {
  constructor(private readonly sid: string) {}

  private get path(): string {
    return join(DATA_DIR, `${this.sid}.json`)
  }

  async load(): Promise<TokenSet | null> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as TokenSet
    } catch {
      return null
    }
  }

  async save(tokens: TokenSet): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    // Escritura completa: el refresh rotado tiene que quedar guardado ANTES
    // de que la siguiente petición lo necesite.
    await writeFile(this.path, JSON.stringify(tokens, null, 2), { mode: 0o600 })
  }

  async clear(): Promise<void> {
    await unlink(this.path).catch(() => undefined)
  }
}
