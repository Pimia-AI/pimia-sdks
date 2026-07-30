/**
 * El flujo vertical: presupuestar una obra en dos campos.
 *
 * Es el ejemplo de lo que un partner aporta — un formulario de su oficio, no el
 * formulario genérico de un ERP. Debajo, la API de Pimia hace el trabajo
 * aburrido (numeración, impuestos, cumplimiento) y ninguna de sus reglas se
 * puede saltar desde aquí: son del servidor.
 */

import Link from 'next/link'

import { callApi, clienteOPortada } from '@/lib/pimia'

import { presupuestar } from './actions'

export default async function Presupuestar({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const { pimia } = await clienteOPortada()

  const response = (await callApi(() => pimia.customers.list({ limit: 100 }))) as {
    data?: Array<{ id: number; name: string }>
  }
  const customers = response?.data ?? []

  return (
    <>
      <p style={{ margin: '0 0 6px' }}>
        <Link href="/panel/presupuestos">← Presupuestos</Link>
      </p>

      <h1>Presupuestar una obra</h1>
      <p className="muted">
        Se crea un presupuesto en Pimia con una sola línea. El número, los
        impuestos y la validez los pone Pimia.
      </p>

      {error ? <div className="notice error">{error}</div> : null}

      {customers.length === 0 ? (
        <div className="notice">
          No hay clientes en este Pimia todavía. Créalos primero (o pide el scope{' '}
          <code>customers:write</code> y hazlo desde aquí).
        </div>
      ) : (
        <form action={presupuestar}>
          <label htmlFor="customer">Cliente</label>
          <select id="customer" name="customer_id" required>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>

          <label htmlFor="descripcion">Obra</label>
          <input
            id="descripcion"
            name="descripcion"
            required
            maxLength={200}
            placeholder="Reforma integral de baño en C/ Mayor 3"
          />

          <label htmlFor="importe">Importe (€, sin IVA)</label>
          <input
            id="importe"
            name="importe"
            required
            inputMode="decimal"
            pattern="[0-9]+([.,][0-9]{1,2})?"
            placeholder="4500"
          />

          <div className="row" style={{ marginTop: 18 }}>
            <button type="submit">Crear presupuesto</button>
            <Link href="/panel/presupuestos">Volver</Link>
          </div>
        </form>
      )}
    </>
  )
}
