/**
 * La Mensajería de Pimia sobre wab-ai: `/api/v1/mensajeria/*`.
 *
 * Son las 15 operaciones que el panel web de Pimia consume para leer y
 * contestar los chats de wab-ai (WhatsApp, Instagram y las redes puente) con
 * el vínculo PERSONAL de quien mira. Exigen `messaging:read` /
 * `messaging:write`, que son de **primera parte**: un client de integrador no
 * los obtiene, y con cualquier otro token la llamada es `403`.
 *
 * Lo que el SDK NO hace, y es a propósito:
 *
 * - no recibe organizaciones, claves ni ids de wab-ai: el servidor deriva todo
 *   del vínculo de la persona en la empresa activa (cabecera `company`), así
 *   que no hay parámetro que permita pedir los chats de otra organización;
 * - no inventa estados: un envío aceptado no es un mensaje entregado; el estado
 *   real viaja en `message.delivery` y en {@link MensajeriaOperation.state}.
 *
 * El cuerpo de error trae el `code` estable (ver {@link mensajeriaError}).
 *
 * Los tipos de conversación y de mensaje se escriben aquí a mano: el contrato
 * los publica como objeto opaco (`additionalProperties`) porque los proyecta
 * `MensajeriaPresenter` con una lista blanca clave a clave. La forma es la del
 * contrato del panel (`mensajeriaContract.ts` de pimia-web) y la del presentador
 * del núcleo (docs/mensajeria/DISENO-BACKEND.md §2.10).
 */

import type { components } from './api.js'
import type { Ok, PimiaClient, ReadOptions, WriteOptions } from './client.js'

// ── Tipos del cable ───────────────────────────────────────────────────

/** Estado de entrega de un saliente, por precedencia `failed > deleted > read > delivered > sent > accepted > held > pending`. */
export type MensajeriaDeliveryState =
  | 'pending'
  | 'held'
  | 'accepted'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'deleted'

export type MensajeriaService = 'local' | 'whatsapp' | 'instagram' | 'matrix'
export type MensajeriaNetwork = 'whatsapp' | 'telegram' | 'linkedin' | 'facebook' | 'instagram'

/** Los sellos de pausa, archivo y fijado de una conversación (ISO o `null`). */
export interface MensajeriaFlags {
  paused_at: string | null
  archived_at: string | null
  pinned_at: string | null
}

export interface MensajeriaLastMessage {
  id: string
  direction: 'incoming' | 'outgoing'
  author_name: string | null
  author_is_me: boolean
  /** Texto plano recortado (≤ 140) o la etiqueta del medio («Foto», «Audio»…). */
  preview: string
  content_type: 'text' | 'file' | 'data' | 'parts' | 'empty'
  content_kind: string | null
  timestamp: string
  /** Solo en salientes. */
  delivery: MensajeriaDeliveryState | null
}

export interface MensajeriaConversation {
  id: string
  service: MensajeriaService
  network: MensajeriaNetwork | null
  /** Ya resuelto: contacto › conversación › dirección › @usuario. */
  display_name: string
  subtitle: string | null
  organization_address: string
  contact_address: string | null
  is_group: boolean
  status: string
  updated_at: string
  flags: MensajeriaFlags
  last_message: MensajeriaLastMessage | null
  last_incoming_at: string | null
  unread_count: number
}

/**
 * Autor de un saliente. `author_key` es un alias opaco y estable POR VÍNCULO
 * (sirve para colorear rachas): no es el id del agente de wab-ai.
 */
export interface MensajeriaAuthor {
  author_key: string
  name: string
  ai: boolean
  is_me: boolean
}

export interface MensajeriaFile {
  name: string | null
  mime_type: string
  size: number | null
  /** Si hay bytes que bajar con {@link mensajeria.media}. Nunca viaja la URI. */
  has_media: boolean
}

export type MensajeriaContent =
  | { version: '1'; type: 'text'; kind: string; text: string }
  | {
      version: '1'
      type: 'file'
      kind: string
      file: MensajeriaFile
      text?: string | null
      artifacts?: { kind: 'transcription' | 'description'; text: string }[]
    }
  | { version: '1'; type: 'data'; kind: string; text: string | null; data_preview: string | null }
  | { version: '1'; type: 'parts'; parts: MensajeriaContent[] }
  | { empty: true }

export interface MensajeriaMessage {
  id: string
  conversation_id: string
  direction: 'incoming' | 'outgoing'
  /** `null` en entrantes, y en salientes cuyo autor ya no existe. */
  author: MensajeriaAuthor | null
  timestamp: string
  updated_at: string
  content: MensajeriaContent
  re_message_id: string | null
  /** `null` en entrantes. */
  delivery: {
    state: MensajeriaDeliveryState
    at: string | null
    edited_at: string | null
    error: { code: 'window_closed' | 'undeliverable' | 'unknown'; title: string } | null
  } | null
}

/** `sent` (hay mensaje), `pending`/`uncertain` (no se sabe aún: reconcilia), `conflict` o `failed`. */
export type MensajeriaOperationState = 'pending' | 'sent' | 'uncertain' | 'conflict' | 'failed'

/** Un envío por su `operation_id`, que es también el id del mensaje en wab-ai. */
export interface MensajeriaOperation {
  id: string
  conversation_id: string
  state: MensajeriaOperationState
  kind: 'text' | 'file' | 'note'
  /** Lo justo para pintar la burbuja recuperada; `null` una vez enviado. */
  text: string | null
  file_name: string | null
  created_at: string
  /** Presente con `sent`. */
  message: MensajeriaMessage | null
  /** Con `conflict` (`payload_mismatch`, `link_changed`) o `failed`. */
  error_code: string | null
}

/** El sobre de las listas: cursor opaco y cuándo se consultó wab-ai. */
export interface MensajeriaListMeta {
  next_cursor: string | null
  polled_at: string
  unread_total?: number
}

export interface MensajeriaList<T> {
  data: T[]
  meta: MensajeriaListMeta
}

export type MensajeriaLink = Ok<'link.show'>['data']
export type MensajeriaLinkIntent = Ok<'link.storeIntent'>['data']
export type MensajeriaAccount = Ok<'accounts.index'>['data'][number]
export type MensajeriaAttachment = Ok<'attachments.store'>['data']

/**
 * El cuerpo del envío. `operation_id` es un UUID v4 que genera el cliente,
 * UNO por mensaje: es a la vez la `Idempotency-Key` y el id del mensaje en
 * wab-ai. Reintentar con el MISMO id nunca duplica; otro contenido con el
 * mismo id es `422 idempotency_key_reused`.
 *
 * `kind: 'note'` está reservado: hoy responde `422 send_not_supported`.
 */
export type MensajeriaSendRequest = components['schemas']['SendMessageRequest']

/**
 * Pausar, archivar o fijar. Booleanos JSON de verdad —ni `1` ni `"true"`—, al
 * menos uno y ninguna otra clave; si no, `422 validation_failed`.
 *
 * ⚠️ Se escribe a mano: el spec los publica como `string` porque el núcleo los
 * valida con un cierre que el generador no sabe leer. El servidor rechaza una
 * cadena.
 */
export type MensajeriaFlagsRequest =
  | { paused: boolean; archived?: boolean; pinned?: boolean }
  | { paused?: boolean; archived: boolean; pinned?: boolean }
  | { paused?: boolean; archived?: boolean; pinned: boolean }

export interface MensajeriaConversationsQuery {
  filter?: 'all' | 'pending' | '24h' | 'archived'
  /** Búsqueda sin acentos, ≤ 100 caracteres. */
  q?: string
  /** El `meta.next_cursor` de la página anterior, tal cual. */
  cursor?: string
  /** 1–50 (por defecto 30). */
  limit?: number
}

/**
 * `before` pagina hacia atrás (el `meta.next_cursor` anterior); `updated_since`
 * (ISO) trae lo que cambió desde entonces, sin cursor. Los dos a la vez son
 * `422 validation_failed`.
 */
export type MensajeriaMessagesQuery =
  | { before?: string; updated_since?: never; limit?: number }
  | { before?: never; updated_since?: string; limit?: number }

// ── El recurso ────────────────────────────────────────────────────────

const seg = (id: string) => encodeURIComponent(id)

/** Las escrituras de la Mensajería no aceptan una clave suelta: la del envío es su `operation_id`. */
type MensajeriaWriteOptions = Omit<WriteOptions, 'idempotencyKey'>

/** @internal Lo monta {@link PimiaClient.mensajeria}. */
export function mensajeriaResource(client: PimiaClient) {
  return {
    link: {
      /**
       * El estado del vínculo de quien mira en la empresa activa. Funciona con
       * el módulo apagado (`module: "off"`) para enseñar el estado real.
       * `connected` solo si wab-ai lo confirmó en ESTA llamada; ante la duda,
       * `pending` con `reason: "wab_unavailable"`.
       */
      get: (options?: ReadOptions) => client.get<Ok<'link.show'>>('/mensajeria/link', undefined, options),
      /**
       * Abre un intento de vinculación y devuelve la `authorize_url` de wab-ai a
       * la que se manda a la persona. Uno vivo por persona: el nuevo sustituye
       * al anterior.
       */
      createIntent: (body: components['schemas']['StoreLinkIntentRequest'], options?: MensajeriaWriteOptions) =>
        client.post<Ok<'link.storeIntent'>>('/mensajeria/link/intents', body, options),
      /**
       * Desvincula a quien mira. Idempotente (sin vínculo también es `200`).
       * Si wab-ai no confirma la revocación, `status: "revoked"` con `reason:
       * "remote_cleanup_pending"`: la termina un barrido. No desconecta las
       * redes de la organización en wab-ai.
       */
      unlink: (options?: ReadOptions) => client.delete<Ok<'link.destroy'>>('/mensajeria/link', options),
    },

    /** Las cuentas (números y perfiles) de la organización vinculada. */
    accounts: (options?: ReadOptions) => client.get<Ok<'accounts.index'>>('/mensajeria/accounts', undefined, options),

    conversations: {
      /** La bandeja, por cursor. */
      list: (query?: MensajeriaConversationsQuery, options?: ReadOptions) =>
        client.get<MensajeriaList<MensajeriaConversation>>(
          '/mensajeria/conversations',
          query as Record<string, string | number | undefined>,
          options,
        ),
      /** Una conversación; otra organización o un id desconocido son `404 conversation_not_found`. */
      get: (conversationId: string, options?: ReadOptions) =>
        client.get<{ data: MensajeriaConversation }>(
          `/mensajeria/conversations/${seg(conversationId)}`,
          undefined,
          options,
        ),
      /** Marca como leída. Responde cuántos mensajes marcó. */
      markRead: (conversationId: string, options?: MensajeriaWriteOptions) =>
        client.post<Ok<'conversationActions.read'>>(
          `/mensajeria/conversations/${seg(conversationId)}/read`,
          undefined,
          options,
        ),
      /** Pausa, archiva o fija. Devuelve los tres sellos resultantes. */
      setFlags: (conversationId: string, flags: MensajeriaFlagsRequest, options?: MensajeriaWriteOptions) =>
        client.patch<Ok<'conversationActions.flags'>>(
          `/mensajeria/conversations/${seg(conversationId)}/flags`,
          flags,
          options,
        ),
    },

    messages: {
      /** Los mensajes de una conversación, del más nuevo al más viejo. */
      list: (conversationId: string, query?: MensajeriaMessagesQuery, options?: ReadOptions) =>
        client.get<MensajeriaList<MensajeriaMessage>>(
          `/mensajeria/conversations/${seg(conversationId)}/messages`,
          query as Record<string, string | number | undefined>,
          options,
        ),
      /**
       * Envía un texto o un fichero ya subido ({@link attachments.upload}). La
       * `Idempotency-Key` es SIEMPRE el `operation_id`: el SDK la pone y no deja
       * mandar otra.
       *
       * Decide por `data.operation.state`, no por el código HTTP:
       * - `sent` (`201`): trae `message`;
       * - `uncertain` (`202`): no se sabe si llegó. **No generes otro id**:
       *   reconcilia con {@link operations.get} o repite ESTE envío con el mismo
       *   `operation_id`;
       * - `conflict` (`200`): ese id ya es otro mensaje (`payload_mismatch`).
       *
       * Errores con `code`: `text_empty`, `text_too_long` (> 4096 puntos de
       * código), `attachment_not_found`, `send_not_supported`,
       * `idempotency_key_reused`, `idempotency_key_expired` (> 24 h),
       * `idempotency_in_progress`, `wab_quota_exceeded` (`402`).
       */
      send: (conversationId: string, body: MensajeriaSendRequest, options?: MensajeriaWriteOptions) => {
        if (typeof body?.operation_id !== 'string' || body.operation_id === '') {
          throw new TypeError('mensajeria.messages.send: falta `operation_id` (un UUID por mensaje).')
        }

        return client.post<{ data: { operation: MensajeriaOperation } }>(
          `/mensajeria/conversations/${seg(conversationId)}/messages`,
          body,
          { ...options, idempotencyKey: body.operation_id },
        )
      },
    },

    attachments: {
      /**
       * Sube el fichero de un envío (multipart con `file` y `operation_id`). El
       * `operation_id` es el MISMO que llevará luego {@link messages.send} con
       * `kind: "file"` y el `attachment_id` devuelto.
       *
       * `201` con el adjunto, o `202` con `{state: "upload_uncertain"}`: repite
       * con el mismo `operation_id` y los mismos bytes. Límites: 16 000 000
       * bytes (`413 attachment_too_large`) y tipos cerrados —imágenes jpeg/png/
       * webp, PDF, texto y ofimática— (`415 unsupported_media_type`). Una
       * operación ya enviada es `409 operation_already_sent`.
       */
      upload: (
        conversationId: string,
        operationId: string,
        file: Blob | [Blob, string],
        options?: MensajeriaWriteOptions,
      ) => {
        const form = new FormData()
        form.append('operation_id', operationId)
        if (Array.isArray(file)) form.append('file', file[0], file[1])
        else form.append('file', file)

        return client.post<Ok<'attachments.store'> | { data: { state: 'upload_uncertain' } }>(
          `/mensajeria/conversations/${seg(conversationId)}/attachments`,
          form,
          options,
        )
      },
    },

    /**
     * Los bytes del medio de un mensaje, como `Blob` (el servidor manda siempre
     * `application/octet-stream`; el tipo real está en `content.file.mime_type`).
     * `part` elige `parts[n]` en un mensaje compuesto. Sin medio, `404
     * media_unavailable`.
     */
    media: (messageId: string, query?: { part?: number }, options?: ReadOptions) =>
      client.download(`/mensajeria/messages/${seg(messageId)}/media`, query, options),

    operations: {
      /**
       * Reconciliar un envío por su `operation_id`. `404 operation_unknown`
       * significa que wab-ai no lo tiene y no es definitivo: repite
       * {@link messages.send} con el MISMO id. Un envío de un vínculo anterior
       * es `conflict` con `error_code: "link_changed"`.
       */
      get: (operationId: string, options?: ReadOptions) =>
        client.get<{ data: MensajeriaOperation }>(`/mensajeria/operations/${seg(operationId)}`, undefined, options),
      /**
       * Los envíos sin cerrar (`pending`, `uncertain`) de quien mira en una
       * conversación, para recuperar las burbujas tras recargar. Sin `message`.
       */
      list: (
        conversationId: string,
        query?: { state?: 'pending' | 'uncertain' | 'pending,uncertain' },
        options?: ReadOptions,
      ) =>
        client.get<{ data: MensajeriaOperation[] }>(
          `/mensajeria/conversations/${seg(conversationId)}/operations`,
          query,
          options,
        ),
    },

    chats: {
      /**
       * Abre (o encuentra) un chat con un contacto en una red puente. Crea una
       * conversación REAL en wab-ai con ese identificador: úsalo solo con
       * números o usuarios que la persona haya escrito a propósito.
       * `identifier_empty`, `identifier_not_found` (`404`),
       * `network_not_configured` y `network_account_missing`.
       */
      create: (body: components['schemas']['CreateChatRequest'], options?: MensajeriaWriteOptions) =>
        client.post<Ok<'chats.store'>>('/mensajeria/chats', body, options),
    },
  }
}

export type MensajeriaResource = ReturnType<typeof mensajeriaResource>

