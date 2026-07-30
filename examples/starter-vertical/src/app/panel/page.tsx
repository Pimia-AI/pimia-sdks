/**
 * Panel: lo que la app vertical enseña de verdad. Componente de servidor, así
 * que las llamadas a Pimia y los tokens no tocan el navegador.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { MissingScopeError } from '@pimia/sdk'

import { callApi, NeedsAuthorization, requireClient } from '@/lib/pimia'

/** Céntimos → euros. La API de Pimia habla en céntimos SIEMPRE. */
function euros(cents: unknown): string {
  const value = typeof cents === 'number' ? cents : Number(cents ?? 0)

  return (value / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
}

function fecha(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '—'
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-ES')
}

/** @return lista de filas, o el scope que falta si la API dijo 403. */
async function fetchList(
  fn: () => Promise<unknown>,
): Promise<{ rows: Array<Record<string, unknown>>; missingScope?: string }> {
  try {
    const response = (await callApi(fn)) as { data?: unknown } | unknown[]
    const data = Array.isArray(response) ? response : (response?.data ?? [])

    return { rows: Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [] }
  } catch (error) {
    // Un 403 por scope no es un fallo del sistema: es que esta app no pidió
    // ese permiso. Se enseña, no se esconde.
    if (error instanceof MissingScopeError) {
      return { rows: [], missingScope: error.scope }
    }

    throw error
  }
}

export default async function Panel() {
  let session
  let pimia

  try {
    ;({ session, pimia } = await requireClient())
  } catch (error) {
    if (error instanceof NeedsAuthorization) redirect('/?error=flujo_incompleto')
    throw error
  }

  const [invoices, customers] = await Promise.all([
    fetchList(() => pimia.invoices.list({ limit: 5 })),
    fetchList(() => pimia.customers.list({ limit: 5 })),
  ])

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>Panel</h1>
          <p className="muted" style={{ margin: 0 }}>
            {session.baseUrl}
          </p>
        </div>
        <form action="/logout" method="post">
          <button className="secondary" type="submit">
            Desconectar
          </button>
        </form>
      </div>

      <h2>Últimas facturas</h2>
      {invoices.missingScope ? (
        <div className="notice">
          Esta app no pidió <code>{invoices.missingScope}</code>, así que Pimia
          no la deja leer facturas. Añade el scope en <code>REQUESTED_SCOPES</code>{' '}
          y vuelve a conectar.
        </div>
      ) : invoices.rows.length === 0 ? (
        <p className="muted">Sin facturas todavía.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Total</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {invoices.rows.map((invoice, index) => (
              <tr key={String(invoice.id ?? index)}>
                {/* El número lo pone Pimia (series y numeración correlativa son
                    requisito legal): tu app lo LEE, nunca lo inventa. Puede
                    venir vacío en facturas que aún no se han emitido. */}
                <td>{String(invoice.invoice_number ?? 'sin numerar')}</td>
                <td>{fecha(invoice.invoice_date)}</td>
                <td>
                  {String(
                    (invoice.customer as Record<string, unknown> | undefined)?.name ??
                      invoice.customer_id ??
                      '—',
                  )}
                </td>
                <td>{euros(invoice.total)}</td>
                <td>{String(invoice.status ?? invoice.paid_status ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Clientes</h2>
      {customers.missingScope ? (
        <div className="notice">
          Falta el scope <code>{customers.missingScope}</code>.
        </div>
      ) : customers.rows.length === 0 ? (
        <p className="muted">Sin clientes todavía.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>NIF</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {customers.rows.map((customer, index) => (
              <tr key={String(customer.id ?? index)}>
                <td>{String(customer.name ?? '—')}</td>
                <td>{String(customer.vat_number ?? customer.tax_number ?? '—')}</td>
                <td>{String(customer.email ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Flujo vertical</h2>
      <p className="muted">
        Aquí va lo que hace ÚNICA a tu app. De ejemplo: presupuestar una obra en
        dos campos, en vez de pasar por el formulario completo de facturación.
      </p>
      <Link className="button" href="/panel/presupuestar">
        Presupuestar una obra
      </Link>
    </>
  )
}
