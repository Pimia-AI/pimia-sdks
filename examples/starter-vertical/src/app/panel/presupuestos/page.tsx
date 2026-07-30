/**
 * Presupuestos: el corazón del flujo vertical. Desde aquí se crea uno nuevo
 * (dos campos, no el formulario entero de un ERP) y se sigue su ciclo:
 * DRAFT → SENT → VIEWED → ACCEPTED / REJECTED / EXPIRED.
 */

import Link from 'next/link'

import { Dinero, Estado, FaltaScope, Paginado } from '@/components/ui'
import { listar } from '@/lib/datos'
import { fecha, texto } from '@/lib/formato'
import { clienteOPortada } from '@/lib/pimia'
import type { PresupuestoFila } from '@/lib/tipos'

export default async function Presupuestos({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page } = await searchParams
  const { pimia } = await clienteOPortada()

  const pagina = Math.max(1, Number(page) || 1)
  const presupuestos = await listar<PresupuestoFila>(() =>
    pimia.estimates.list({ limit: 25, page: pagina }),
  )

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Presupuestos</h1>
          <p className="muted" style={{ margin: 0 }}>
            De borrador a aceptado; al aceptarse, se convierte en factura.
          </p>
        </div>
        <Link className="button" href="/panel/presupuestos/nuevo">
          Presupuestar una obra
        </Link>
      </div>

      {presupuestos.missingScope ? (
        <FaltaScope scope={presupuestos.missingScope} />
      ) : presupuestos.rows.length === 0 ? (
        <p className="muted">Sin presupuestos todavía. Crea el primero.</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Caduca</th>
                <th>Cliente</th>
                <th>Estado</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {presupuestos.rows.map((presupuesto) => (
                <tr key={presupuesto.id}>
                  <td>
                    <Link href={`/panel/presupuestos/${presupuesto.id}`}>
                      {texto(presupuesto.estimate_number)}
                    </Link>
                  </td>
                  <td>{fecha(presupuesto.estimate_date)}</td>
                  <td>{fecha(presupuesto.expiry_date)}</td>
                  <td>{texto(presupuesto.customer?.name)}</td>
                  <td>
                    <Estado valor={presupuesto.status} />
                  </td>
                  <td className="num">
                    <Dinero cents={presupuesto.total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Paginado meta={presupuestos.meta} base="/panel/presupuestos" />
        </>
      )}
    </>
  )
}
