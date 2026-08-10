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
 *
 * **Manda solo lo que decides tú.** El cuerpo de este ejemplo era el triple de
 * largo porque replicaba lo que envía el panel. Ya no hace falta, y esas dos
 * lecciones costaron un bug cada una:
 *
 *  - `estimate_number` es **opcional** desde el 2026-08-06: si no llega, lo
 *    asigna el servidor con el mismo formateador que usa el panel, ya dentro de
 *    la transacción que escribe. Pedirlo antes con `GET /next-number` —como
 *    hacía este ejemplo— solo añadía una carrera que el servidor no tiene: ese
 *    endpoint no reserva nada y dos llamadas seguidas devuelven el mismo
 *    número, así que el segundo en guardar se comía un `422`. Sirve para
 *    previsualizar en una interfaz, no para escribir;
 *  - `sub_total`, `tax` y `total` los **recompone el servidor** desde las
 *    líneas, y `discount`/`discount_val` se rellenan solos. Por línea, igual
 *    con `discount_val`, `tax` y `total`. Enviarlos es fabricar un checksum
 *    contra ti mismo.
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
    const created = await pimia.estimates.create({
      // Si tu tenant tiene VARIAS empresas, manda también la cabecera
      // `company` (el SDK admite `headers`): sin ella la API usa la primera
      // empresa del usuario, que puede no ser la que quieres.
      customer_id: customerId,
      estimate_date: today,
      expiry_date: expiry,
      items: [
        {
          name: descripcion.slice(0, 100),
          description: descripcion,
          quantity: 1,
          price: cents,
        },
      ],
    })

    // Al detalle del recién creado: ahí viven los siguientes pasos del ciclo
    // (marcarlo como enviado, convertirlo en factura…). El `data.id` ya viene
    // tipado del spec: sin castings ni `?? r?.id` defensivos.
    const nuevoId = created.data.id

    redirect(nuevoId ? `/panel/presupuestos/${nuevoId}?ok=creado` : '/panel/presupuestos')
  } catch (error) {
    // `redirect()` lanza por diseño en Next: hay que dejarlo pasar.
    if (esRedirectDeNext(error)) throw error

    redirect('/panel/presupuestos/nuevo?error=' + encodeURIComponent(mensajeDeError(error)))
  }
}
