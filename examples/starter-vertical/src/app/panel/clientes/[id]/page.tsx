/**
 * Ficha de cliente: datos de contacto y fiscales + sus facturas.
 *
 * Las facturas salen del MISMO endpoint de siempre con el filtro
 * `customer_id` — un patrón general de la API: las listas aceptan filtros por
 * columna. (Verificado contra dev; el spec aún no documenta todos los
 * filtros.)
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Cobro, Dinero, Estado, FaltaScope } from '@/components/ui'
import { detalle, listar } from '@/lib/datos'
import { euros, fecha, texto } from '@/lib/formato'
import { clienteOPortada } from '@/lib/pimia'
import type { ClienteDetalle, FacturaFila } from '@/lib/tipos'

export default async function Cliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { pimia } = await clienteOPortada()

  const [cliente, facturas] = await Promise.all([
    detalle<ClienteDetalle>(() => pimia.customers.get(id)),
    listar<FacturaFila>(() => pimia.invoices.list({ customer_id: id, limit: 10 })),
  ])

  if (cliente.missingScope) {
    return (
      <>
        <h1>Cliente</h1>
        <FaltaScope scope={cliente.missingScope} />
      </>
    )
  }
  if (!cliente.data) notFound()

  const c = cliente.data
  const direccion = c.billing
    ? [c.billing.address_street_1, c.billing.address_street_2, c.billing.zip, c.billing.city, c.billing.state]
        .filter((parte) => parte != null && parte !== '')
        .join(', ')
    : ''

  return (
    <>
      <p style={{ margin: '0 0 6px' }}>
        <Link href="/panel/clientes">← Clientes</Link>
      </p>

      <h1>{texto(c.name)}</h1>

      <div className="ficha">
        <div className="bloque">
          <dl>
            <dt>Persona de contacto</dt>
            <dd>{texto(c.contact_name)}</dd>
            <dt>Email</dt>
            <dd>{texto(c.email)}</dd>
            <dt>Teléfono</dt>
            <dd>{texto(c.phone)}</dd>
          </dl>
        </div>
        <div className="bloque">
          <dl>
            <dt>NIF</dt>
            <dd>{texto(c.tax_id)}</dd>
            <dt>Dirección de facturación</dt>
            <dd>{direccion === '' ? '—' : direccion}</dd>
            <dt>IBAN</dt>
            <dd>{texto(c.iban)}</dd>
          </dl>
        </div>
        <div className="bloque">
          <dl>
            <dt>Pendiente de cobro</dt>
            <dd className="num" style={{ textAlign: 'left', fontSize: 18 }}>
              {euros(c.due_amount)}
            </dd>
            <dt>Web</dt>
            <dd>{texto(c.website)}</dd>
          </dl>
        </div>
      </div>

      <h2>Sus facturas</h2>
      {facturas.missingScope ? (
        <FaltaScope scope={facturas.missingScope} />
      ) : facturas.rows.length === 0 ? (
        <p className="muted">Todavía no tiene facturas.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Fecha</th>
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
                    {texto(factura.invoice_number) === '—' ? 'sin numerar' : factura.invoice_number}
                  </Link>
                </td>
                <td>{fecha(factura.invoice_date)}</td>
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
      )}

      {c.notes ? (
        <>
          <h2>Notas</h2>
          <p className="muted">{c.notes}</p>
        </>
      ) : null}
    </>
  )
}
