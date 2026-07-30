'use server'

/**
 * El resto del ciclo del presupuesto, contra los endpoints de acción de la
 * API (`POST /estimates/{id}/status`, `POST /estimates/{id}/convert-to-invoice`).
 *
 * Ojo con la conversión: crea una FACTURA de verdad (en borrador). Si la API
 * responde 403 por scope, el SDK lo tipa como `MissingScopeError` y la UI
 * explica qué falta — así debe morir una operación sin permiso: con
 * instrucciones, no con un 500.
 */

import { redirect } from 'next/navigation'

import { esRedirectDeNext, mensajeDeError } from '@/lib/errores'
import { requireClient } from '@/lib/pimia'

/** DRAFT → SENT sin mandar email: registra que el presupuesto ya salió. */
export async function marcarEnviado(id: number): Promise<never> {
  const { pimia } = await requireClient()

  try {
    await pimia.post(`/estimates/${id}/status`, { status: 'SENT' })

    redirect(`/panel/presupuestos/${id}?ok=enviado`)
  } catch (error) {
    if (esRedirectDeNext(error)) throw error

    redirect(`/panel/presupuestos/${id}?error=` + encodeURIComponent(mensajeDeError(error)))
  }
}

/**
 * Presupuesto aceptado → factura. La numeración de la factura nueva la decide
 * Pimia; la app solo recibe el id y navega a ella.
 */
export async function convertirEnFactura(id: number): Promise<never> {
  const { pimia } = await requireClient()

  try {
    const response = (await pimia.post(`/estimates/${id}/convert-to-invoice`)) as {
      data?: { id?: number }
    }
    const facturaId = response?.data?.id

    redirect(facturaId ? `/panel/facturas/${facturaId}` : '/panel/facturas')
  } catch (error) {
    if (esRedirectDeNext(error)) throw error

    redirect(`/panel/presupuestos/${id}?error=` + encodeURIComponent(mensajeDeError(error)))
  }
}
