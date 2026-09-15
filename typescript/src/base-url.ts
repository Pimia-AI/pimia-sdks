/** Evita duplicar /api sin corregir silenciosamente la configuración. */
export function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '')
  let path: string
  try {
    path = new URL(normalized).pathname.replace(/\/+$/, '')
  } catch {
    // Esta guarda solo detecta el prefijo duplicado; otros errores de URL
    // conservan la validación que ya hacía el cliente al enviar la llamada.
    return normalized
  }
  if (/\/api(?:\/v1)?$/.test(path)) {
    throw new TypeError('baseUrl debe ser el origen de la API, sin /api ni /api/v1 (p. ej. https://acme.pimia.es); el cliente añade el prefijo de las llamadas.')
  }
  return normalized
}
