/**
 * Clientes: lista paginada. `due_amount` es lo que ese cliente debe en total —
 * lo calcula la API, la app solo lo pinta.
 */

import Link from 'next/link'

import { Dinero, FaltaScope, Paginado } from '@/components/ui'
import { listar } from '@/lib/datos'
import { texto } from '@/lib/formato'
import { clienteOPortada } from '@/lib/pimia'
import type { ClienteFila } from '@/lib/tipos'

export default async function Clientes({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const { page } = await searchParams
  const { pimia } = await clienteOPortada()

  const pagina = Math.max(1, Number(page) || 1)
  const clientes = await listar<ClienteFila>(() =>
    pimia.customers.list({ limit: 25, page: pagina }),
  )

  return (
    <>
      <h1>Clientes</h1>
      <p className="muted">Los clientes de tu Pimia, con su riesgo vivo.</p>

      {clientes.missingScope ? (
        <FaltaScope scope={clientes.missingScope} />
      ) : clientes.rows.length === 0 ? (
        <p className="muted">Sin clientes todavía.</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>NIF</th>
                <th>Email</th>
                <th>Teléfono</th>
                <th className="num">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {clientes.rows.map((cliente) => (
                <tr key={cliente.id}>
                  <td>
                    <Link href={`/panel/clientes/${cliente.id}`}>{texto(cliente.name)}</Link>
                  </td>
                  <td>{texto(cliente.tax_id)}</td>
                  <td>{texto(cliente.email)}</td>
                  <td>{texto(cliente.phone)}</td>
                  <td className="num">
                    <Dinero cents={cliente.due_amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Paginado meta={clientes.meta} base="/panel/clientes" />
        </>
      )}
    </>
  )
}
