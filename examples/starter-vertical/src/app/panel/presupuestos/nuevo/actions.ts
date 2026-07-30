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

import { esRedirectDeNext, mensajeDeError } from '@/lib/errores'
import { requireClient } from '@/lib/pimia'

/** «4500,50» → 450050 céntimos. */
function toCents(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null

  return Math.round(Number(normalized) * 100)
}

/**
 * El número de documento lo decide PIMIA, no tú: la numeración es correlativa
 * por empresa y con formato configurable (requisito legal). Pero al crear un
 * presupuesto hay que MANDARLO, así que primero se pide:
 *
 *   GET /next-number?key=estimate  →  { nextNumber: "PRE-000130" }
 *
 * `next-number` vive en el dominio `meta`, que cualquier token puede leer: no
 * hace falta un scope extra. Claves disponibles: invoice, credit_note,
 * estimate, payment, delivery_note.
 *
 * Ojo con la carrera: entre pedir el número y crear el documento, otro cliente
 * puede haber usado ese hueco — el número es único por empresa y la API
 * responderá 422. Pídelo justo antes de crear y reintenta si choca.
 */
async function nextNumber(
  pimia: Awaited<ReturnType<typeof requireClient>>['pimia'],
  key: 'estimate' | 'invoice',
): Promise<string> {
  const response = (await pimia.get('/next-number', { key })) as { nextNumber?: string }

  if (!response?.nextNumber) {
    throw new Error('Pimia no devolvió el siguiente número de documento.')
  }

  return response.nextNumber
}

export async function presupuestar(formData: FormData): Promise<never> {
  const { pimia } = await requireClient()

  const customerId = Number(formData.get('customer_id'))
  const descripcion = String(formData.get('descripcion') ?? '').trim()
  const cents = toCents(String(formData.get('importe') ?? ''))

  if (!customerId || descripcion === '' || cents === null) {
    redirect('/panel/presupuestos/nuevo?error=' + encodeURIComponent('Revisa los campos.'))
  }

  const today = new Date().toISOString().slice(0, 10)
  const expiry = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

  try {
    const created = (await pimia.estimates.create({
      // Si tu tenant tiene VARIAS empresas, manda también la cabecera
      // `company` (el SDK admite `headers`): sin ella la API usa la primera
      // empresa del usuario, que puede no ser la que quieres.
      estimate_number: await nextNumber(pimia, 'estimate'),
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
          // ⚠️ La validación de la API NO exige estos tres campos, pero el
          // servidor los lee al crear la línea: sin ellos responde 500 en vez
          // de 422 (verificado contra dev el 2026-07-30). Mándalos siempre,
          // aunque no apliques descuento.
          discount: '0',
          discount_type: 'fixed',
          discount_val: 0,
        },
      ],
    })) as { data?: { id?: number } }

    // Al detalle del recién creado: ahí viven los siguientes pasos del ciclo
    // (marcarlo como enviado, convertirlo en factura…).
    const nuevoId = created?.data?.id

    redirect(nuevoId ? `/panel/presupuestos/${nuevoId}?ok=creado` : '/panel/presupuestos')
  } catch (error) {
    // `redirect()` lanza por diseño en Next: hay que dejarlo pasar.
    if (esRedirectDeNext(error)) throw error

    redirect('/panel/presupuestos/nuevo?error=' + encodeURIComponent(mensajeDeError(error)))
  }
}
