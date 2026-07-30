/** Formateo compartido. La API habla en céntimos y fechas YYYY-MM-DD. */

/** Céntimos → «1.234,56 €». La API de Pimia habla en céntimos SIEMPRE. */
export function euros(cents: number | null | undefined): string {
  const value = typeof cents === 'number' ? cents : 0

  return (value / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

export function fecha(value: string | null | undefined): string {
  if (typeof value !== 'string' || value === '') return '—'
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-ES')
}

export function texto(value: string | null | undefined): string {
  return value == null || value === '' ? '—' : value
}
