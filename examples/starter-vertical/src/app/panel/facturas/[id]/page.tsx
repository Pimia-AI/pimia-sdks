/**
 * Detalle de factura: cabecera, líneas, desglose de impuestos y cobros.
 *
 * Fíjate en lo que NO hay: botón de borrar. Una factura emitida se rectifica
 * (nota de crédito), no se borra — es ley, y la API lo impide aunque una app
 * lo intente. Si el tenant tiene VeriFactu activo, `aeat_status` cuenta en qué
 * estado está el envío a la AEAT.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Cobro, Dinero, Estado, FaltaScope } from '@/components/ui'
import { detalle } from '@/lib/datos'
import { euros, fecha, texto } from '@/lib/formato'
import { clienteOPortada } from '@/lib/pimia'
import type { FacturaDetalle } from '@/lib/tipos'

const AEAT: Record<string, { texto: string; tono: string }> = {
  PENDING: { texto: 'VeriFactu: pendiente', tono: 'aviso' },
  REGISTERED: { texto: 'VeriFactu: registrada', tono: 'ok' },
  ERROR: { texto: 'VeriFactu: error', tono: 'mal' },
}

export default async function Factura({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { pimia } = await clienteOPortada()

  const factura = await detalle<FacturaDetalle>(() => pimia.invoices.get(id))

  if (factura.missingScope) {
    return (
      <>
        <h1>Factura</h1>
        <FaltaScope scope={factura.missingScope} />
      </>
    )
  }
  if (!factura.data) notFound()

  const f = factura.data
  const aeat = f.aeat_status ? (AEAT[f.aeat_status] ?? { texto: `VeriFactu: ${f.aeat_status}`, tono: '' }) : null

  return (
    <>
      <p style={{ margin: '0 0 6px' }}>
        <Link href="/panel/facturas">← Facturas</Link>
      </p>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>
          {texto(f.invoice_number) === '—' ? 'Factura sin numerar' : f.invoice_number}
          {f.is_credit_note ? ' (rectificativa)' : null}
        </h1>
        <div className="row">
          <Estado valor={f.status} />
          <Cobro factura={f} />
          {aeat ? <span className={`badge ${aeat.tono}`}>{aeat.texto}</span> : null}
        </div>
      </div>

      <div className="ficha">
        <div className="bloque">
          <dl>
            <dt>Cliente</dt>
            <dd>
              {f.customer ? (
                <Link href={`/panel/clientes/${f.customer.id}`}>{f.customer.name}</Link>
              ) : (
                '—'
              )}
            </dd>
            <dt>Fecha de emisión</dt>
            <dd>{fecha(f.invoice_date)}</dd>
            <dt>Vencimiento</dt>
            <dd>{fecha(f.due_date)}</dd>
          </dl>
        </div>
        <div className="bloque">
          <dl>
            <dt>Pendiente de cobro</dt>
            <dd className="num" style={{ textAlign: 'left', fontSize: 18 }}>
              {euros(f.due_amount)}
            </dd>
            <dt>Documento</dt>
            <dd>
              {f.invoice_pdf_url ? (
                <a href={f.invoice_pdf_url} target="_blank" rel="noreferrer">
                  Ver PDF
                </a>
              ) : (
                '—'
              )}
            </dd>
          </dl>
        </div>
      </div>

      {/* Las relaciones (items, taxes) pueden faltar en la respuesta: se
          renderiza lo que haya y los totales agregados siempre existen. */}
      {f.items && f.items.length > 0 ? (
        <>
          <h2>Líneas</h2>
          <table>
            <thead>
              <tr>
                <th>Concepto</th>
                <th className="num">Cantidad</th>
                <th className="num">Precio</th>
                <th className="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              {f.items.map((linea) => (
                <tr key={linea.id}>
                  <td>
                    {texto(linea.name)}
                    {linea.description && linea.description !== linea.name ? (
                      <div className="muted" style={{ fontSize: 13 }}>
                        {linea.description}
                      </div>
                    ) : null}
                  </td>
                  <td className="num">{linea.quantity ?? '—'}</td>
                  <td className="num">
                    <Dinero cents={linea.price} />
                  </td>
                  <td className="num">
                    <Dinero cents={linea.total} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <table className="totales">
        <tbody>
          <tr>
            <td>Base imponible</td>
            <td className="num">
              <Dinero cents={f.sub_total} />
            </td>
          </tr>
          {f.taxes && f.taxes.length > 0 ? (
            f.taxes.map((impuesto) => (
              <tr key={impuesto.id}>
                <td>{texto(impuesto.name)}</td>
                <td className="num">
                  <Dinero cents={impuesto.amount} />
                </td>
              </tr>
            ))
          ) : f.tax ? (
            <tr>
              <td>Impuestos</td>
              <td className="num">
                <Dinero cents={f.tax} />
              </td>
            </tr>
          ) : null}
          <tr className="total">
            <td>Total</td>
            <td className="num">
              <Dinero cents={f.total} />
            </td>
          </tr>
        </tbody>
      </table>

      {f.payments && f.payments.length > 0 ? (
        <>
          <h2>Cobros</h2>
          <table>
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th className="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              {f.payments.map((pago) => (
                <tr key={pago.id}>
                  <td>{texto(pago.payment_number)}</td>
                  <td>{fecha(pago.payment_date)}</td>
                  <td className="num">
                    <Dinero cents={pago.amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {f.notes ? (
        <>
          <h2>Notas</h2>
          <p className="muted">{f.notes}</p>
        </>
      ) : null}
    </>
  )
}
