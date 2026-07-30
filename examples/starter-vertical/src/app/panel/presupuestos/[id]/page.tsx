/**
 * Detalle de presupuesto: el documento y sus siguientes pasos.
 *
 *  - DRAFT: se puede «marcar como enviado» (cambia el estado, no manda email);
 *  - cualquier estado: «convertir en factura» crea una factura BORRADOR de
 *    verdad. Si al grant le falta permiso, la action lo cuenta como un 403
 *    de scope bien explicado (la demo permanente del 403 vive en /panel/gastos).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Dinero, Estado, FaltaScope } from '@/components/ui'
import { detalle } from '@/lib/datos'
import { fecha, texto } from '@/lib/formato'
import { clienteOPortada } from '@/lib/pimia'
import type { PresupuestoDetalle } from '@/lib/tipos'

import { convertirEnFactura, marcarEnviado } from './actions'

const OK: Record<string, string> = {
  creado: 'Presupuesto creado en Pimia. Este es su detalle.',
  enviado: 'Marcado como enviado: el ciclo sigue en manos del cliente.',
}

export default async function Presupuesto({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ ok?: string; error?: string }>
}) {
  const [{ id }, { ok, error }] = await Promise.all([params, searchParams])
  const { pimia } = await clienteOPortada()

  const presupuesto = await detalle<PresupuestoDetalle>(() => pimia.estimates.get(id))

  if (presupuesto.missingScope) {
    return (
      <>
        <h1>Presupuesto</h1>
        <FaltaScope scope={presupuesto.missingScope} />
      </>
    )
  }
  if (!presupuesto.data) notFound()

  const p = presupuesto.data

  return (
    <>
      <p style={{ margin: '0 0 6px' }}>
        <Link href="/panel/presupuestos">← Presupuestos</Link>
      </p>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{texto(p.estimate_number)}</h1>
        <Estado valor={p.status} />
      </div>

      {ok && OK[ok] ? <div className="notice exito">{OK[ok]}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

      <div className="ficha">
        <div className="bloque">
          <dl>
            <dt>Cliente</dt>
            <dd>
              {p.customer ? (
                <Link href={`/panel/clientes/${p.customer.id}`}>{p.customer.name}</Link>
              ) : (
                '—'
              )}
            </dd>
            <dt>Fecha</dt>
            <dd>{fecha(p.estimate_date)}</dd>
            <dt>Caduca</dt>
            <dd>{fecha(p.expiry_date)}</dd>
          </dl>
        </div>
        <div className="bloque">
          <dl>
            <dt>Documento</dt>
            <dd>
              {p.estimate_pdf_url ? (
                <a href={p.estimate_pdf_url} target="_blank" rel="noreferrer">
                  Ver PDF
                </a>
              ) : (
                '—'
              )}
            </dd>
          </dl>
        </div>
      </div>

      {/* Las relaciones (items, taxes) pueden faltar en la respuesta de la
          API (verificado contra dev): se renderiza lo que haya y los totales
          agregados siempre existen. */}
      {p.items && p.items.length > 0 ? (
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
              {p.items.map((linea) => (
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
              <Dinero cents={p.sub_total} />
            </td>
          </tr>
          {p.taxes && p.taxes.length > 0 ? (
            p.taxes.map((impuesto) => (
              <tr key={impuesto.id}>
                <td>{texto(impuesto.name)}</td>
                <td className="num">
                  <Dinero cents={impuesto.amount} />
                </td>
              </tr>
            ))
          ) : p.tax ? (
            <tr>
              <td>Impuestos</td>
              <td className="num">
                <Dinero cents={p.tax} />
              </td>
            </tr>
          ) : null}
          <tr className="total">
            <td>Total</td>
            <td className="num">
              <Dinero cents={p.total} />
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Siguientes pasos</h2>
      <div className="row">
        {p.status === 'DRAFT' ? (
          <form action={marcarEnviado.bind(null, p.id)}>
            <button type="submit">Marcar como enviado</button>
          </form>
        ) : null}
        <form action={convertirEnFactura.bind(null, p.id)}>
          <button className="secondary" type="submit">
            Convertir en factura
          </button>
        </form>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        «Convertir en factura» crea una factura de verdad en Pimia (en
        borrador: numerarla y emitirla sigue siendo decisión tuya). Si tu grant
        no tiene permiso para esa operación, la API responde 403 y aquí se
        cuenta qué scope falta y cómo pedirlo.
      </p>

      {p.notes ? (
        <>
          <h2>Notas</h2>
          <p className="muted">{p.notes}</p>
        </>
      ) : null}
    </>
  )
}
