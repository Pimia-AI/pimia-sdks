// Guardia de tipos de la Mensajería (factSaas#963). Sin esto, un sync que
// dejara el spec viejo —o un generador que volviera a tipar los flags como
// cadenas— compilaría igual.
import type { MensajeriaMessage, PimiaClient } from '../../dist/index.js'

declare const client: PimiaClient
const m = client.mensajeria

// El envío exige su operation_id y no admite otra clave de idempotencia.
// @ts-expect-error Sin `operation_id` no compila.
void m.messages.send('c', { kind: 'text', text: 'Hola' })
// @ts-expect-error La clave del envío ES el operation_id: no hay opción para otra.
void m.messages.send('c', { operation_id: 'u', kind: 'text', text: 'Hola' }, { idempotencyKey: 'otra' })
void m.messages.send('c', { operation_id: 'u', kind: 'file', attachment_id: 'a', text: null })

declare const envio: Awaited<ReturnType<typeof m.messages.send>>
envio.data.operation.state satisfies 'pending' | 'sent' | 'uncertain' | 'conflict' | 'failed'
envio.data.operation.message satisfies MensajeriaMessage | null

// Los flags son booleanos JSON, al menos uno.
void m.conversations.setFlags('c', { paused: true })
// @ts-expect-error El servidor rechaza "true": el spec dice string, el SDK no.
void m.conversations.setFlags('c', { paused: 'true' })
// @ts-expect-error Sin ninguna clave no compila.
void m.conversations.setFlags('c', {})

// La bandeja: conversaciones con forma, cursor y filtros cerrados.
declare const bandeja: Awaited<ReturnType<typeof m.conversations.list>>
bandeja.meta.next_cursor satisfies string | null
bandeja.data[0]?.flags.archived_at satisfies string | null | undefined
bandeja.data[0]?.unread_count satisfies number | undefined
// @ts-expect-error Filtro inexistente.
void m.conversations.list({ filter: 'unread' })

// Mensajes: `before` y `updated_since` no van juntos.
void m.messages.list('c', { before: 'x' })
void m.messages.list('c', { updated_since: '2026-09-26T00:00:00Z' })
// @ts-expect-error Los dos a la vez son 422.
void m.messages.list('c', { before: 'x', updated_since: '2026-09-26T00:00:00Z' })

declare const mensaje: MensajeriaMessage
if ('type' in mensaje.content && mensaje.content.type === 'file') {
  mensaje.content.file.has_media satisfies boolean
  // @ts-expect-error La URI interna no viaja nunca.
  void mensaje.content.file.uri
}

// El vínculo, las cuentas y los adjuntos salen del spec.
declare const vinculo: Awaited<ReturnType<typeof m.link.get>>
vinculo.data.status satisfies string
vinculo.data.has_live_key satisfies boolean
declare const cuentas: Awaited<ReturnType<typeof m.accounts>>
cuentas.data[0]?.can_create_chat satisfies boolean | undefined
// @ts-expect-error `return_to` es cerrado.
void m.link.createIntent({ return_to: 'inicio' })

// El medio es un Blob, no texto.
declare const medio: Awaited<ReturnType<typeof m.media>>
medio satisfies Blob
