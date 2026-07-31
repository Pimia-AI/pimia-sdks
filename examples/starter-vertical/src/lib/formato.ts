/** Formateo compartido. La API habla en céntimos y fechas YYYY-MM-DD. */

/**
 * Céntimos → «1.234,56 €». La API de Pimia habla en céntimos SIEMPRE, pero no
 * siempre en `number`: algunos campos calculados llegan como string decimal —
 * `total: 121000` y `due_amount: "121000.00"` en la MISMA factura (verificado
 * contra dev el 2026-07-31). Coacciona siempre.
 */
export function euros(cents: number | string | null | undefined): string {
  const value = typeof cents === 'number' ? cents : Number(cents ?? 0)
  const safe = Number.isFinite(value) ? value : 0

  return (safe / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

export function fecha(value: string | null | undefined): string {
  if (typeof value !== 'string' || value === '') return '—'
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-ES')
}

export function texto(value: string | null | undefined): string {
  return value == null || value === '' ? '—' : value
}
