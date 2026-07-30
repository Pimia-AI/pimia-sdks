/**
 * Paso 2 de la demo e2e: todo el ciclo de vida con el SDK, contra la API real.
 *
 *   node run.mjs <code-del-callback>
 *
 * Demuestra, en este orden:
 *   1. canje del código (client confidencial, PKCE)
 *   2. llamada con un scope concedido        → 200
 *   3. llamada a un dominio SIN scope        → MissingScopeError tipado
 *   4. refresco                              → rotación persistida en el store
 *   5. llamada con el token nuevo            → 200
 *   6. revocación RFC 7009 + llamada        → UnauthorizedError (cascada)
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'

import { MissingScopeError, OAuth, PimiaClient, UnauthorizedError } from '@pimia/sdk'

const STORE_PATH = '/tmp/pimia-e2e-tokens.json'

/** TokenStore de fichero: el mínimo ejemplo de una implementación real. */
class FileTokenStore {
  load() {
    if (!existsSync(STORE_PATH)) return null
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf8'))
    return raw
  }

  save(tokens) {
    writeFileSync(STORE_PATH, JSON.stringify(tokens, null, 2))
  }

  clear() {
    if (existsSync(STORE_PATH)) unlinkSync(STORE_PATH)
  }
}

const client = JSON.parse(process.env.PIMIA_CLIENT_JSON)
const session = JSON.parse(readFileSync('/tmp/pimia-e2e-session.json', 'utf8'))
const code = process.argv[2]

const config = {
  baseUrl: process.env.PIMIA_BASE_URL,
  clientId: client.client_id,
  clientSecret: client.client_secret,
  redirectUri: client.redirect_uris[0],
}

const store = new FileTokenStore()
const oauth = new OAuth(config)

// ── 1. Canje ────────────────────────────────────────────────────────────────
const tokens = await oauth.exchangeCode(code, { verifier: session.verifier, method: 'S256' })
store.save(tokens)

console.log('1. CANJE')
console.log('   scope:', tokens.scope)
console.log('   expires_in:', Math.round((tokens.expiresAt - Date.now()) / 1000), 's')
console.log('   refresh:', tokens.refreshToken.slice(0, 8) + '…')

const pimia = new PimiaClient({ ...config, tokens: store })

// ── 2. Dominio concedido ────────────────────────────────────────────────────
const invoices = await pimia.invoices.list({ limit: 3 })
const rows = invoices?.data ?? invoices
console.log('\n2. GET /invoices (invoices:read concedido)')
console.log('   OK ·', Array.isArray(rows) ? `${rows.length} facturas` : typeof rows)
console.log('   rate limit:', JSON.stringify(pimia.rateLimit))

const customers = await pimia.customers.list({ limit: 2 })
console.log('   GET /customers (customers:read concedido) → OK ·',
  Array.isArray(customers?.data) ? `${customers.data.length} clientes` : 'respuesta recibida')

// ── 3. Dominio SIN scope ────────────────────────────────────────────────────
console.log('\n3. GET /expenses (expenses:read NO concedido)')
try {
  await pimia.get('/expenses')
  console.log('   ⚠️ INESPERADO: debería haber dado 403')
} catch (error) {
  if (error instanceof MissingScopeError) {
    console.log(`   MissingScopeError · status ${error.status} · scope que falta: ${error.scope}`)
  } else {
    console.log('   ⚠️ error inesperado:', error.constructor.name, error.message)
  }
}

// ── 4. Refresco con rotación ────────────────────────────────────────────────
console.log('\n4. REFRESCO (rotación)')
const before = store.load()
const rotated = await oauth.refresh(before.refreshToken)
store.save(rotated)
const after = store.load()

console.log('   refresh viejo:', before.refreshToken.slice(0, 8) + '…')
console.log('   refresh nuevo:', after.refreshToken.slice(0, 8) + '…')
console.log('   distintos:', before.refreshToken !== after.refreshToken)
console.log('   access rotado:', before.accessToken !== after.accessToken)
console.log('   persistido en el store:', after.refreshToken === rotated.refreshToken)

// ── 5. El token nuevo funciona ──────────────────────────────────────────────
const afterRefresh = await pimia.invoices.list({ limit: 1 })
console.log('\n5. GET /invoices con el token rotado → OK ·',
  Array.isArray(afterRefresh?.data) ? `${afterRefresh.data.length} factura` : 'respuesta recibida')

// ── 6. Revocación ───────────────────────────────────────────────────────────
console.log('\n6. REVOCACIÓN (RFC 7009) del refresh → cascada del grant')
await oauth.revoke(after.refreshToken)

try {
  await pimia.invoices.list()
  console.log('   ⚠️ INESPERADO: el token seguía valiendo')
} catch (error) {
  console.log(
    error instanceof UnauthorizedError
      ? `   UnauthorizedError · status ${error.status} — el SDK intentó refrescar, también murió: hay que re-autorizar`
      : `   ${error.constructor.name}: ${error.message}`,
  )
}

store.clear()
console.log('\nstore local limpiado.')
