// Guardia de tipos del correo (factSaas#954, fase A). Sin esto, un sync que
// dejara el spec viejo —o un generador que volviera a tipar el alta como el
// literal `201`— compilaría igual.
import type { MailAdminMailboxResource, PimiaClient } from '../../dist/index.js'

declare const client: PimiaClient

// El alta de buzón EXIGE su Idempotency-Key: sin ella, dos reintentos crean dos buzones.
// @ts-expect-error `idempotencyKey` es obligatoria en el alta.
void client.mail.admin.mailboxes.create({ kind: 'shared' }, {})
// @ts-expect-error Y sin opciones tampoco compila.
void client.mail.admin.mailboxes.create({ kind: 'shared' })
void client.mail.admin.mailboxes.create({ kind: 'shared', local_part: 'obras' }, { idempotencyKey: 'k' })

// El alta devuelve el buzón del inventario, no el número 201.
declare const alta: Awaited<ReturnType<typeof client.mail.admin.mailboxes.create>>
alta.data.id satisfies string
alta.data.member_count satisfies number
declare const inventario: MailAdminMailboxResource
inventario.kind satisfies string

// `personal` pide `owner_user_id`, que es el id NUMÉRICO de Pimia.
void client.mail.admin.mailboxes.create({ kind: 'personal', owner_user_id: 7 }, { idempotencyKey: 'k2' })
// @ts-expect-error El id de usuario es numérico, no una cadena.
void client.mail.admin.members.add('mb_1', '7')

// El mensaje: texto plano e imágenes remotas como booleano.
declare const mensaje: Awaited<ReturnType<typeof client.mail.messages.get>>
mensaje.data.text_body satisfies string
mensaje.data.blocked_remote_images satisfies boolean
// @ts-expect-error No hay HTML en el cable.
void mensaje.data.html_body

// La página lleva su cursor opaco y si el histórico está completo.
declare const pagina: Awaited<ReturnType<typeof client.mail.messages.list>>
pagina.meta.next_cursor satisfies string | null
pagina.meta.history_complete satisfies boolean
