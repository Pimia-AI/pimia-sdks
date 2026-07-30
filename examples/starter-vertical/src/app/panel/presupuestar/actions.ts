'use server'

/**
 * La escritura: crear el presupuesto en Pimia.
 *
 * Dos lecciones para el integrador:
 *
 *  - **los importes van en CÉNTIMOS**, entero. `4500,50 €` es `450050`. Es la
 *    convención de toda la API y la fuente de bugs número uno;
 *  - **la validación es del servidor**. Un `422` trae los errores por campo en
 *    `error.errors`: enséñalos, no los tragues. Y un `403` significa que tu app
 *    no pidió `estimates:write`.
 */

import { redirect } from 'next/navigation'

import { MissingScopeError, ValidationError } from '@pimia/sdk'

import { requireClient } from '@/lib/pimia'

/** «4500,50» → 450050 céntimos. */
function toCents(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null

  return Math.round(Number(normalized) * 100)
}

export async function presupuestar(formData: FormData): Promise<never> {
  const { pimia } = await requireClient()

  const customerId = Number(formData.get('customer_id'))
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const cents = toCents(String(formData.get('importe') ?? ''))

  if (!customerId || descripcion === '' || cents === null) {
    redirect('/panel/presupuestar?error=' + encodeURIComponent('Revisa los campos.'))
  }

  const today = new Date().toISOString().slice(0, 10)
  const expiry = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

  try {
    const created = (await pimia.estimates.create({
      customer_id: customerId,
      estimate_date: today,
      expiry_date: expiry,
      sub_total: cents,
      total: cents,
      tax: 0,
      discount: '0',
      discount_val: 0,
      discount_type: 'fixed',
      items: [
        {
          name: descripcion.slice(0, 100),
          description: descripcion,
          quantity: 1,
          price: cents,
          total: cents,
        },
      ],
    })) as { data?: { estimate_number?: string } }

    redirect(
      '/panel/presupuestar?ok=' +
        encodeURIComponent(created?.data?.estimate_number ?? 'creado'),
    )
  } catch (error) {
    // `redirect()` lanza por diseño en Next: hay que dejarlo pasar.
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error

    if (error instanceof MissingScopeError) {
      redirect(
        '/panel/presupuestar?error=' +
          encodeURIComponent(
            `Tu app no tiene el permiso ${error.scope}. Añádelo a REQUESTED_SCOPES y vuelve a conectar.`,
          ),
      )
    }

    if (error instanceof ValidationError) {
      const detalle = Object.entries(error.errors)
        .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
        .join(' · ')

      redirect('/panel/presupuestar?error=' + encodeURIComponent(detalle || error.message))
    }

    redirect(
      '/panel/presupuestar?error=' +
        encodeURIComponent(error instanceof Error ? error.message : 'Error inesperado'),
    )
  }
}
