/**
 * Gastos: la demo viva del modelo de permisos.
 *
 * Esta app NO pide `expenses:read` a propósito, así que con el grant de
 * referencia esta página enseña el 403 de scope contado como es debido: qué
 * permiso falta y cómo pedirlo. Si tu app añade el scope (a
 * `REQUESTED_SCOPES` y al registro del client) y el usuario vuelve a
 * autorizar, esta misma página pasa a listar los gastos de verdad — sin
 * cambiar ni una línea de código.
 */

import { Dinero, FaltaScope, Paginado } from '@/components/ui'
import { listar } from '@/lib/datos'
import { fecha, texto } from '@/lib/formato'
import { clienteOPortada } from '@/lib/pimia'
import type { GastoFila } from '@/lib/tipos'

export default async function Gastos({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page } = await searchParams
  const { pimia } = await clienteOPortada()

  const pagina = Math.max(1, Number(page) || 1)
  const gastos = await listar<GastoFila>(() => pimia.get('/expenses', { limit: 25, page: pagina }))

  return (
    <>
      <h1>Gastos</h1>
      <p className="muted">
        Los gastos del negocio: compras menores con ticket, sin factura formal.
      </p>

      {gastos.missingScope ? (
        <FaltaScope scope={gastos.missingScope} />
      ) : gastos.rows.length === 0 ? (
        <p className="muted">Sin gastos todavía.</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Categoría</th>
                <th>Notas</th>
                <th className="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              {gastos.rows.map((gasto) => (
                <tr key={gasto.id}>
                  <td>{fecha(gasto.expense_date)}</td>
                  <td>{texto(gasto.expense_category?.name)}</td>
                  <td>{texto(gasto.notes)}</td>
                  <td className="num">
                    <Dinero cents={gasto.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Paginado meta={gastos.meta} base="/panel/gastos" />
        </>
      )}
    </>
  )
}
