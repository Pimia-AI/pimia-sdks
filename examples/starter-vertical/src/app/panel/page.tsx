/**
 * Resumen: la portada del ERP. Componente de servidor — las llamadas a Pimia
 * y los tokens no tocan el navegador.
 *
 * Los contadores salen de `meta.total` de las mismas listas que ya pedimos:
 * cero endpoints extra.
 */

import Link from 'next/link'

import { Dinero, Estado, FaltaScope } from '@/components/ui'
import { listar } from '@/lib/datos'
import { fecha, texto } from '@/lib/formato'
import { clienteOPortada } from '@/lib/pimia'
import type { FacturaFila, PresupuestoFila } from '@/lib/tipos'

export default async function Panel() {
  const { session, pimia } = await clienteOPortada()

  const [facturas, presupuestos, clientes] = await Promise.all([
    listar<FacturaFila>(() => pimia.invoices.list({ limit: 5 })),
    listar<PresupuestoFila>(() => pimia.estimates.list({ limit: 5 })),
    listar(() => pimia.customers.list({ limit: 1 })),
  ])

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Resumen</h1>
          <p className="muted" style={{ margin: 0 }}>
            {session.baseUrl}
          </p>
        </div>
        <Link className="button" href="/panel/presupuestos/nuevo">
          Presupuestar una obra
        </Link>
      </div>

      <div className="cards">
        <div className="card">
          <div className="etiqueta">Facturas</div>
          <div className="valor">{facturas.meta?.total ?? facturas.rows.length}</div>
        </div>
        <div className="card">
          <div className="etiqueta">Presupuestos</div>
          <div className="valor">{presupuestos.meta?.total ?? presupuestos.rows.length}</div>
        </div>
        <div className="card">
          <div className="etiqueta">Clientes</div>
          <div className="valor">{clientes.meta?.total ?? clientes.rows.length}</div>
        </div>
      </div>

      <h2>Últimas facturas</h2>
      {facturas.missingScope ? (
        <FaltaScope scope={facturas.missingScope} />
      ) : facturas.rows.length === 0 ? (
        <p className="muted">Sin facturas todavía.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Estado</th>
              <th>Cobro</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {facturas.rows.map((factura) => (
              <tr key={factura.id}>
                <td>
                  {/* El número lo pone Pimia (numeración correlativa legal):
                      la app lo LEE. Vacío = aún sin emitir. */}
                  <Link href={`/panel/facturas/${factura.id}`}>
                    {texto(factura.invoice_number) === '—' ? 'sin numerar' : factura.invoice_number}
                  </Link>
                </td>
                <td>{fecha(factura.invoice_date)}</td>
                <td>{texto(factura.customer?.name)}</td>
                <td>
                  <Estado valor={factura.status} />
                </td>
                <td>
                  <Estado valor={factura.overdue ? 'OVERDUE' : factura.paid_status} />
                </td>
                <td className="num">
                  <Dinero cents={factura.total} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Últimos presupuestos</h2>
      {presupuestos.missingScope ? (
        <FaltaScope scope={presupuestos.missingScope} />
      ) : presupuestos.rows.length === 0 ? (
        <p className="muted">Sin presupuestos todavía.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Fecha</th>
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
      )}
    </>
  )
}
