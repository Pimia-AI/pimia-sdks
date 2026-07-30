/**
 * Configuración del starter. Todo por entorno: un partner despliega la misma
 * imagen apuntando a distintos tenants.
 */

function required(name: string): string {
  const value = process.env[name]

  if (!value || value.trim() === '') {
    throw new Error(
      `Falta la variable de entorno ${name}. Copia .env.example a .env.local y rellénala (ver README).`,
    )
  }

  return value.trim()
}

export const config = {
  /**
   * Tenant por defecto: `https://acme.pimia.es`. En Pimia **un tenant es un
   * servidor de autorización y una API**, y un token solo vale ahí. Si tu app
   * sirve a varios clientes, resuelve esto por usuario (aquí se permite
   * override con `/login?tenant=https://otro.pimia.es`).
   */
  get defaultBaseUrl() {
    return required('PIMIA_BASE_URL').replace(/\/+$/, '')
  },

  get clientId() {
    return required('PIMIA_CLIENT_ID')
  },

  /**
   * Client confidencial (registrado con `client_secret_post`). Vive SOLO en el
   * servidor: nunca lo pases a un componente de cliente ni a NEXT_PUBLIC_*.
   */
  get clientSecret() {
    return required('PIMIA_CLIENT_SECRET')
  },

  get appUrl() {
    return required('APP_URL').replace(/\/+$/, '')
  },

  get redirectUri() {
    return `${this.appUrl}/callback`
  },

  /** Secreto para firmar las cookies de sesión (32+ bytes aleatorios). */
  get sessionSecret() {
    return required('SESSION_SECRET')
  },

  /** Cookies `Secure` salvo en local. */
  get secureCookies() {
    return this.appUrl.startsWith('https://')
  },
}

/**
 * Scopes que pide esta app. Regla: **el mínimo que necesites**. El usuario los
 * ve uno a uno en la pantalla de consentimiento de Pimia, con las escrituras
 * marcadas aparte — pedir de más es la forma más rápida de que no te autorice.
 */
export const REQUESTED_SCOPES = [
  'invoices:read',
  'customers:read',
  'estimates:read',
  'estimates:write',
] as const
