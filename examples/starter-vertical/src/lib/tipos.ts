/**
 * Los campos de la API que ESTA app lee, ni uno más. La API devuelve muchos
 * otros (el contrato completo está en spec/pimia-api-v1.json del monorepo);
 * tiparlos a demanda mantiene honesto lo que la app usa de verdad.
 *
 * Recordatorio permanente: todos los importes vienen en CÉNTIMOS enteros.
 */

export interface ClienteRef {
  id: number
  name: string
}

export interface FacturaFila {
  id: number
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  status: string | null
  paid_status: string | null
  overdue: boolean | null
  is_credit_note: boolean | null
  total: number | null
  due_amount: number | null
  customer_id: number | null
  customer?: ClienteRef | null
}

export interface LineaDocumento {
  id: number
  name: string | null
  description: string | null
  quantity: number | null
  price: number | null
  tax: number | null
  total: number | null
}

export interface ImpuestoDocumento {
  id: number
  name: string | null
  amount: number | null
  percent: number | null
}

export interface PagoFila {
  id: number
  payment_number?: string | null
  payment_date?: string | null
  amount: number | null
}

export interface FacturaDetalle extends FacturaFila {
  sub_total: number | null
  tax: number | null
  discount_val: number | null
  notes: string | null
  /** Estado en VeriFactu (AEAT); null si el tenant no lo tiene activo. */
  aeat_status: string | null
  invoice_pdf_url: string | null
  // Las relaciones pueden NO venir: la API las omite cuando no las carga
  // (verificado contra dev el 2026-07-30 en presupuestos). Renderiza
  // defensivo y cae a los totales agregados (sub_total, tax, total).
  items?: LineaDocumento[]
  taxes?: ImpuestoDocumento[]
  payments?: PagoFila[]
}

export interface DireccionFacturacion {
  name?: string | null
  address_street_1?: string | null
  address_street_2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  phone?: string | null
}

export interface ClienteFila {
  id: number
  name: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
  /** NIF/CIF. */
  tax_id: string | null
  due_amount: number | null
}

export interface ClienteDetalle extends ClienteFila {
  website: string | null
  iban: string | null
  notes: string | null
  billing?: DireccionFacturacion | null
}

export interface PresupuestoFila {
  id: number
  estimate_number: string | null
  estimate_date: string | null
  expiry_date: string | null
  status: string | null
  total: number | null
  customer_id: number | null
  customer?: ClienteRef | null
}

export interface PresupuestoDetalle extends PresupuestoFila {
  sub_total: number | null
  tax: number | null
  notes: string | null
  estimate_pdf_url: string | null
  items?: LineaDocumento[]
  taxes?: ImpuestoDocumento[]
}

export interface GastoFila {
  id: number
  expense_date: string | null
  amount: number | null
  notes: string | null
  expense_category?: { id: number; name: string | null } | null
}
