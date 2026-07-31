/**
 * Facturas: la lista completa, paginada con el `meta` que devuelve la API.
 * Solo lectura — esta app pide `invoices:read` y nada más. Emitir, cobrar o
 * rectificar siguen siendo cosa del panel de Pimia (o de una app con
 * `invoices:write`).
 */

import Link from 'next/link'

import { Cobro, Dinero, Estado, FaltaScope, Paginado } from '@/components/ui'
import { listar } from '@/lib/datos'
import { fecha, texto } from '@/lib/formato'
import { clienteOPortada } from '@/lib/pimia'
import type { FacturaFila } from '@/lib/tipos'

export default async function Facturas({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page } = await searchParams
  const { pimia } = await clienteOPortada()

  const pagina = Math.max(1, Number(page) || 1)
  const facturas = await listar<FacturaFila>(() =>
    pimia.invoices.list({ limit: 25, page: pagina }),
  )

  return (
    <>
      <h1>Facturas</h1>
      <p className="muted">
        Emitidas en Pimia. Una factura emitida no se borra jamás: se rectifica —
        la regla vive en el servidor, no en esta app.
      </p>

      {facturas.missingScope ? (
        <FaltaScope scope={facturas.missingScope} />
      ) : facturas.rows.length === 0 ? (
        <p className="muted">Sin facturas todavía.</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Vencimiento</th>
                <th>Cliente</th>
                <th>Estado</th>
                <th>Cobro</th>
                <th className="num">Total</th>
                <th className="num">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {facturas.rows.map((factura) => (
                <tr key={factura.id}>
                  <td>
                    <Link href={`/panel/facturas/${factura.id}`}>
                      {texto(factura.invoice_number) === '—'
                        ? 'sin numerar'
                        : factura.invoice_number}
                    </Link>
                    {factura.is_credit_note ? ' (rectificativa)' : null}
                  </td>
                  <td>{fecha(factura.invoice_date)}</td>
                  <td>{fecha(factura.due_date)}</td>
                  <td>{texto(factura.customer?.name)}</td>
                  <td>
                    <Estado valor={factura.status} />
                  </td>
                  <td>
                    <Cobro factura={factura} />
                  </td>
                  <td className="num">
                    <Dinero cents={factura.total} />
                  </td>
                  <td className="num">
                    <Dinero cents={factura.due_amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Paginado meta={facturas.meta} base="/panel/facturas" />
        </>
      )}
    </>
  )
}
