/**
 * Piezas de UI compartidas. Componentes de servidor sin estado: la app de
 * referencia no necesita ni un solo componente de cliente.
 */

import Link from 'next/link'

import type { MetaPagina } from '@/lib/datos'
import { euros } from '@/lib/formato'

/** Importe en mono tabular. Úsalo SIEMPRE dentro de una celda .num. */
export function Dinero({ cents }: { cents: number | null | undefined }) {
  return <>{euros(cents)}</>
}

/** Estados de documentos de la API, con etiqueta en español y tono. */
const ESTADOS: Record<string, { texto: string; tono: 'neutro' | 'info' | 'ok' | 'aviso' | 'mal' }> = {
  DRAFT: { texto: 'Borrador', tono: 'neutro' },
  SENT: { texto: 'Enviado', tono: 'info' },
  VIEWED: { texto: 'Visto', tono: 'info' },
  ACCEPTED: { texto: 'Aceptado', tono: 'ok' },
  REJECTED: { texto: 'Rechazado', tono: 'mal' },
  EXPIRED: { texto: 'Caducado', tono: 'mal' },
  COMPLETED: { texto: 'Completada', tono: 'ok' },
  DUE: { texto: 'Pendiente', tono: 'aviso' },
  OVERDUE: { texto: 'Vencida', tono: 'mal' },
  UNPAID: { texto: 'Sin cobrar', tono: 'aviso' },
  PARTIALLY_PAID: { texto: 'Cobro parcial', tono: 'aviso' },
  PAID: { texto: 'Cobrada', tono: 'ok' },
}

export function Estado({ valor }: { valor: string | null | undefined }) {
  if (!valor) return <span className="muted">—</span>

  const estado = ESTADOS[valor] ?? { texto: valor, tono: 'neutro' as const }

  return <span className={`badge ${estado.tono === 'neutro' ? '' : estado.tono}`}>{estado.texto}</span>
}

/** Aviso estándar de scope que falta, con la instrucción de arreglo. */
export function FaltaScope({ scope }: { scope: string }) {
  return (
    <div className="notice">
      Esta app no pidió el permiso <code>{scope}</code>, así que Pimia no deja
      hacer esta operación. Añádelo a <code>REQUESTED_SCOPES</code> (y al
      registro del client) y vuelve a conectar.
    </div>
  )
}

/** Paginación estilo Laravel: anterior / siguiente + total. */
export function Paginado({ meta, base }: { meta: MetaPagina | null; base: string }) {
  if (!meta || meta.last_page <= 1) return null

  const pagina = meta.current_page

  return (
    <div className="paginado">
      {pagina > 1 ? <Link href={`${base}?page=${pagina - 1}`}>← Anteriores</Link> : null}
      <span>
        Página {pagina} de {meta.last_page} · {meta.total} en total
      </span>
      {pagina < meta.last_page ? <Link href={`${base}?page=${pagina + 1}`}>Siguientes →</Link> : null}
    </div>
  )
}
