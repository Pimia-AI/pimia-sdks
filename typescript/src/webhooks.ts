/**
 * Webhooks entrantes: verificación de la firma PIMIA-WEBHOOK-v1 y tipos de los
 * payloads del catálogo.
 *
 * Existe porque sin esto cada integrador reescribe el mismo HMAC a mano —y con
 * él las mismas tres trampas—: firmar el JSON reserializado en vez de los bytes
 * recibidos, comparar la firma con `===`, y olvidar la ventana anti-replay.
 *
 * ```ts
 * // Express: OJO, `express.raw()`, no `express.json()`.
 * app.post('/pimia', express.raw({ type: 'application/json' }), async (req, res) => {
 *   let hook
 *   try {
 *     hook = await verifyWebhook({
 *       secret: process.env.PIMIA_WEBHOOK_SECRET,
 *       headers: req.headers,
 *       body: req.body,
 *     })
 *   } catch (error) {
 *     return res.status(400).send((error as WebhookVerificationError).reason)
 *   }
 *
 *   // Idempotencia: la MISMA entrega reintentada llega con el mismo
 *   // `delivery`. Procesa cada uno una sola vez y responde 2xx a los repes.
 *   if (await yaProcesado(hook.delivery)) return res.sendStatus(200)
 *
 *   if (hook.known) {
 *     switch (hook.event) {
 *       case 'estimate.accepted':
 *         await facturar(hook.payload.id) // payload tipado, sin castings
 *         break
 *       case 'invoice.paid':
 *         await cobrar(hook.payload.id)
 *         break
 *     }
 *   }
 *
 *   res.sendStatus(200) // responde rápido: el trabajo pesado, a una cola
 * })
 * ```
 */

import { PimiaError } from './errors.js'

/** Versión del canónico firmado. Primera línea de lo que se pasa por el HMAC. */
export const WEBHOOK_SIGNATURE_VERSION = 'PIMIA-WEBHOOK-v1'

/** Cabeceras que Pimia manda en cada entrega (en minúsculas, se leen sin distinguir mayúsculas). */
export const WEBHOOK_HEADERS = {
  signature: 'x-pimia-signature',
  timestamp: 'x-pimia-timestamp',
  event: 'x-pimia-event',
  delivery: 'x-pimia-delivery',
} as const

/** Ventana anti-replay por defecto, en segundos. */
export const WEBHOOK_DEFAULT_TOLERANCE_SECONDS = 300

/**
 * Catálogo de eventos v1 (`config/webhooks.php` del core).
 *
 * Suscribirse a uno que este SDK todavía no conozca no rompe nada: la firma se
 * verifica igual y la entrega vuelve con `known: false`.
 */
export const WEBHOOK_EVENTS = [
  'approval.decided',
  'invoice.received',
  'app.revoked',
  'customer.created',
  'customer.updated',
  'invoice.created',
  'estimate.accepted',
  'invoice.paid',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value)
}

/**
 * Marca de tiempo ISO-8601 **con offset** (`2026-08-10T12:34:56+02:00`), nunca
 * `Z` puro: el core las emite con `toIso8601String()`.
 */
export type IsoDateTime = string

/** Une un enum abierto: autocompleta los valores conocidos sin cerrar el tipo. */
type OpenEnum<T extends string> = T | (string & {})

/**
 * Una decisión de aprobación delegada se resolvió.
 *
 * Es de plano tenant (no de company) y solo llega al `client_id` dueño de la
 * propuesta.
 */
export interface ApprovalDecidedPayload {
  plane: OpenEnum<'pyme' | 'gestoria' | 'integrator'>
  /** La referencia con la que propusiste la tarea: tu asidero de correlación. */
  delegation_ref: string
  outcome: OpenEnum<'pass' | 'edit' | 'reject'>
  task_type: string | null
  autonomous: boolean
  /** Sello de verificabilidad. `null` si el plano no lo deriva. */
  sello: OpenEnum<'pass' | 'fail' | 'n/a'> | null
  verification_level: number | null
  /** Tenant key (la que conoces por tu grant), no el slug interno. */
  tenant: string | null
  verified_at: IsoDateTime | null
}

/**
 * Alta de una factura recibida (libro de recibidas).
 *
 * Los tipos son deliberadamente anchos: a diferencia del resto del catálogo,
 * este payload NO castea `id`, `sequence_number` ni `currency_id` en origen
 * (`app/Models/ReceivedInvoice.php`), así que pueden llegar como número o como
 * cadena según el driver. Normaliza con `Number(...)` antes de comparar.
 */
export interface InvoiceReceivedPayload {
  id: number | string
  number: string | null
  sequence_number: number | string | null
  /** Siempre presente; sus dos claves pueden ser `null` si no hay proveedor. */
  supplier: { id: number | string | null; name: string | null }
  /** En céntimos. */
  total: number
  currency_id: number | string | null
  created_at: IsoDateTime | null
}

/**
 * Un grant OAuth quedó revocado: deja de usar sus tokens y vuelve a pedir
 * autorización. `reason: 'reuse'` significa que alguien canjeó un refresh ya
 * rotado — casi siempre, dos procesos refrescando a la vez sin store compartido.
 */
export interface AppRevokedPayload {
  client_id: string
  /** `null` = plano central. */
  tenant_id: string | null
  user_id: number | string
  reason: OpenEnum<'revoked' | 'reuse'>
  revoked_tokens: number
}

/** Alta o edición de cliente. Sin PII (ni email ni NIF) por decisión del core. */
export interface CustomerPayload {
  id: number
  name: string
  company_id: number
  created_at: IsoDateTime | null
  updated_at: IsoDateTime | null
}

/** Alta de factura. Importes en céntimos. */
export interface InvoiceCreatedPayload {
  id: number
  /** `null` mientras es borrador: el número se asigna al publicar. */
  number: string | null
  sequence_number: number | null
  status: OpenEnum<'DRAFT' | 'PUBLISHED' | 'SENT' | 'VIEWED' | 'COMPLETED'>
  paid_status: OpenEnum<'UNPAID' | 'PARTIALLY_PAID' | 'PAID'>
  is_credit_note: boolean
  customer_id: number | null
  company_id: number
  sub_total: number
  tax: number
  total: number
  due_amount: number
  currency_id: number | null
  created_at: IsoDateTime | null
}

/**
 * El CLIENTE FINAL aceptó el presupuesto. Es una transición, no un estado: solo
 * se emite en el cambio a `ACCEPTED`.
 */
export interface EstimateAcceptedPayload {
  id: number
  number: string | null
  sequence_number: number | null
  status: 'ACCEPTED'
  customer_id: number | null
  /** Lead de Pimia. `null` si la oportunidad vive en tu sistema, no aquí. */
  lead_id: number | null
  company_id: number
  sub_total: number
  tax: number
  total: number
  currency_id: number | null
  accepted_at: IsoDateTime | null
}

/**
 * La factura quedó cobrada del todo. `PARTIALLY_PAID` no emite: es una
 * transición a `PAID`.
 */
export interface InvoicePaidPayload {
  id: number
  number: string | null
  status: OpenEnum<'DRAFT' | 'PUBLISHED' | 'SENT' | 'VIEWED' | 'COMPLETED'>
  paid_status: 'PAID'
  is_credit_note: boolean
  customer_id: number | null
  company_id: number
  /** En céntimos. */
  total: number
  /** 0 en el caso normal; **negativo** si hubo sobrepago. */
  due_amount: number
  currency_id: number | null
  paid_at: IsoDateTime | null
}

/** Payload de cada evento del catálogo, por nombre. */
export interface WebhookPayloads {
  'approval.decided': ApprovalDecidedPayload
  'invoice.received': InvoiceReceivedPayload
  'app.revoked': AppRevokedPayload
  'customer.created': CustomerPayload
  'customer.updated': CustomerPayload
  'invoice.created': InvoiceCreatedPayload
  'estimate.accepted': EstimateAcceptedPayload
  'invoice.paid': InvoicePaidPayload
}

interface WebhookBase {
  /**
   * Id de la entrega (cabecera `X-Pimia-Delivery`). **Tu clave de idempotencia
   * como receptor**: un reintento de Pimia trae el mismo id, así que procesar
   * cada uno una sola vez es todo lo que hace falta para el exactly-once.
   */
  delivery: string
  /** Epoch en segundos de la cabecera `X-Pimia-Timestamp`, ya validado. */
  timestamp: number
}

/** Entrega de un evento del catálogo que este SDK conoce y tipa. */
export type KnownWebhook = {
  [K in WebhookEvent]: WebhookBase & { known: true; event: K; payload: WebhookPayloads[K] }
}[WebhookEvent]

/**
 * Entrega verificada de un evento que este SDK todavía no tipa (catálogo del
 * servidor más nuevo que tu versión del SDK).
 */
export interface UnknownWebhook extends WebhookBase {
  known: false
  event: string
  payload: unknown
}

/**
 * Entrega verificada.
 *
 * El `known` está para que el `switch` sobre `event` narre EXACTO en los ocho
 * eventos tipados sin cerrarle la puerta a uno nuevo: sin él, la rama abierta
 * contaminaría el payload de todas las demás con `unknown`.
 */
export type PimiaWebhook = KnownWebhook | UnknownWebhook

/** Por qué se rechazó una entrega. Legible por máquina, para tus métricas. */
export type WebhookVerificationReason =
  | 'missing_headers'
  | 'invalid_timestamp'
  | 'timestamp_out_of_window'
  | 'signature_mismatch'
  | 'invalid_json'

/**
 * La entrega no es de Pimia, o no es fresca, o no es JSON.
 *
 * Contesta `400` y no proceses nada. Una racha de estos con
 * `signature_mismatch` es la señal de que el secreto de tu endpoint y el del
 * panel han dejado de coincidir.
 */
export class WebhookVerificationError extends PimiaError {
  constructor(
    readonly reason: WebhookVerificationReason,
    message: string,
  ) {
    super(message)
  }
}

/** Lo que se puede leer como cabeceras: `Headers`, `req.headers` de Node o un `Map`. */
export type WebhookHeadersInput =
  | Headers
  | Map<string, string | string[] | undefined>
  | Record<string, string | string[] | undefined>

/** El cuerpo TAL Y COMO LLEGÓ. Nunca un objeto ya parseado (ver {@link verifyWebhook}). */
export type WebhookBodyInput = string | Uint8Array | ArrayBuffer

export interface VerifyWebhookOptions {
  /**
   * Secreto del endpoint (el del panel de Pimia). Acepta una lista para poder
   * rotarlo sin ventana de caída: durante el cambio, valen los dos.
   */
  secret: string | readonly string[]
  headers: WebhookHeadersInput
  /**
   * **Los bytes crudos del cuerpo.** Ver el aviso de {@link verifyWebhook}.
   */
  body: WebhookBodyInput
  /** Ventana anti-replay en segundos (por defecto 300, la del emisor). */
  toleranceSeconds?: number
  /** Reloj en segundos epoch. Inyectable solo para tests. */
  now?: () => number
}

/**
 * Verifica una entrega y devuelve el evento tipado.
 *
 * ⚠️ **`body` tienen que ser los BYTES tal y como llegaron.** Pimia firma
 * exactamente el JSON que envía: parsear y volver a serializar produce un
 * objeto equivalente pero otros bytes, y la firma deja de cuadrar sin que se
 * vea por qué. En Express eso significa `express.raw({ type: 'application/json' })`;
 * con `fetch`, `await request.text()` **antes** de cualquier `.json()`.
 *
 * Qué comprueba, en este orden: que estén las cuatro cabeceras, que el
 * timestamp sea un número dentro de la ventana anti-replay, que el HMAC-SHA256
 * del canónico coincida (comparación en tiempo constante) y que el cuerpo sea
 * JSON. Cualquier fallo lanza {@link WebhookVerificationError} con su `reason`.
 *
 * Lo que NO hace, porque es tuyo: deduplicar por `delivery`. Pimia reintenta
 * hasta cinco veces con backoff, así que una entrega puede llegarte más de una
 * vez con la misma firma válida.
 */
export async function verifyWebhook(options: VerifyWebhookOptions): Promise<PimiaWebhook> {
  const signature = readHeader(options.headers, WEBHOOK_HEADERS.signature)
  const timestampRaw = readHeader(options.headers, WEBHOOK_HEADERS.timestamp)
  const event = readHeader(options.headers, WEBHOOK_HEADERS.event)
  const delivery = readHeader(options.headers, WEBHOOK_HEADERS.delivery)

  if (!signature || !timestampRaw || !event || !delivery) {
    throw new WebhookVerificationError(
      'missing_headers',
      'Faltan cabeceras de firma: se esperan x-pimia-signature, x-pimia-timestamp, x-pimia-event y x-pimia-delivery.',
    )
  }

  const timestamp = Number(timestampRaw)

  if (!Number.isFinite(timestamp)) {
    throw new WebhookVerificationError(
      'invalid_timestamp',
      `La cabecera x-pimia-timestamp no es un número: ${timestampRaw}`,
    )
  }

  const tolerance = options.toleranceSeconds ?? WEBHOOK_DEFAULT_TOLERANCE_SECONDS
  const now = options.now?.() ?? Math.floor(Date.now() / 1000)
  const age = Math.abs(now - timestamp)

  if (age > tolerance) {
    throw new WebhookVerificationError(
      'timestamp_out_of_window',
      `Entrega fuera de la ventana anti-replay: ${age}s de desfase, el máximo es ${tolerance}s.`,
    )
  }

  const bodyBytes = toBytes(options.body)
  const canonical = canonicalBytes(timestampRaw, event, delivery, bodyBytes)
  const secrets = typeof options.secret === 'string' ? [options.secret] : options.secret

  let matches = false

  for (const secret of secrets) {
    const expected = `sha256=${await hmacSha256Hex(secret, canonical)}`
    // Sin cortocircuito: se comprueban todos los secretos siempre, para que el
    // tiempo de respuesta no diga cuál de ellos acertó.
    matches = constantTimeEquals(signature, expected) || matches
  }

  if (!matches) {
    throw new WebhookVerificationError(
      'signature_mismatch',
      'La firma no coincide: la entrega no viene de Pimia, o el secreto del endpoint no es el que crees, o el cuerpo se reserializó por el camino.',
    )
  }

  let payload: unknown

  try {
    payload = JSON.parse(new TextDecoder().decode(bodyBytes))
  } catch {
    throw new WebhookVerificationError(
      'invalid_json',
      'La firma es válida pero el cuerpo no es JSON. No debería pasar: repórtalo.',
    )
  }

  const base = { delivery, timestamp }

  return isWebhookEvent(event)
    ? ({ ...base, known: true, event, payload } as KnownWebhook)
    : { ...base, known: false, event, payload }
}

export interface SignWebhookOptions {
  secret: string
  event: string
  /** Id de la entrega: el valor de `X-Pimia-Delivery`. */
  deliveryId: number | string
  body: WebhookBodyInput
  /** Epoch en segundos. Por defecto, ahora. */
  timestamp?: number
}

/**
 * Firma un cuerpo como lo haría Pimia y devuelve sus cuatro cabeceras.
 *
 * Está aquí **para que puedas testear tu receptor** sin reimplementar el HMAC
 * —que es justo lo que este módulo viene a evitar—: monta el cuerpo que
 * esperas, fírmalo y mándaselo a tu handler. En producción no lo necesitas:
 * quien firma es Pimia.
 */
export async function signWebhook(options: SignWebhookOptions): Promise<Record<string, string>> {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
  const delivery = String(options.deliveryId)
  const canonical = canonicalBytes(
    String(timestamp),
    options.event,
    delivery,
    toBytes(options.body),
  )

  return {
    [WEBHOOK_HEADERS.signature]: `sha256=${await hmacSha256Hex(options.secret, canonical)}`,
    [WEBHOOK_HEADERS.timestamp]: String(timestamp),
    [WEBHOOK_HEADERS.event]: options.event,
    [WEBHOOK_HEADERS.delivery]: delivery,
  }
}

/**
 * El canónico: versión, timestamp, evento e id de entrega en texto, y el cuerpo
 * pegado como BYTES. Se concatena en binario a propósito —en vez de armar una
 * cadena— para no meter un viaje de ida y vuelta por UTF-8 que pudiera alterar
 * lo que se firma.
 */
function canonicalBytes(
  timestamp: string,
  event: string,
  delivery: string,
  body: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const prefix = new TextEncoder().encode(
    `${WEBHOOK_SIGNATURE_VERSION}\n${timestamp}\n${event}\n${delivery}\n`,
  )
  const canonical = new Uint8Array(prefix.length + body.length)
  canonical.set(prefix)
  canonical.set(body, prefix.length)

  return canonical
}

function toBytes(body: WebhookBodyInput): Uint8Array {
  if (typeof body === 'string') return new TextEncoder().encode(body)
  if (body instanceof Uint8Array) return body

  return new Uint8Array(body)
}

/** WebCrypto, no `node:crypto`: el SDK vale en cualquier runtime con `fetch`. */
async function hmacSha256Hex(secret: string, message: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))

  let hex = ''
  for (const byte of signature) hex += byte.toString(16).padStart(2, '0')

  return hex
}

/**
 * Comparación en tiempo constante.
 *
 * Con `===`, el tiempo de comparación depende del prefijo que acierta, y eso
 * permite construir una firma válida byte a byte. La longitud sí se compara
 * antes: una firma de otra longitud ya es inválida y su longitud no es secreta.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)

  return diff === 0
}

function readHeader(headers: WebhookHeadersInput, name: string): string | undefined {
  const raw =
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get(name)
      : headers instanceof Map
        ? (headers.get(name) ?? headers.get(name.toLowerCase()))
        : pickInsensitive(headers as Record<string, string | string[] | undefined>, name)

  const value = Array.isArray(raw) ? raw[0] : raw

  return value === null || value === undefined || value === '' ? undefined : value
}

function pickInsensitive(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | string[] | undefined {
  const direct = headers[name]
  if (direct !== undefined) return direct

  const wanted = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key]
  }

  return undefined
}
