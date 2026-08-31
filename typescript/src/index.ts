/**
 * @pimia/sdk — cliente TypeScript de la API de Pimia para apps de partner.
 *
 * Un tenant = una base URL = un token (modelo un-token-por-tienda). Empieza
 * por README.md; el contrato completo de endpoints está en el OpenAPI del que
 * salen los tipos de `./api`.
 */

export { PimiaClient, toFormData } from './client.js'
export type {
  ContractRequest,
  ContractResource,
  CustomerRequest,
  CustomerResource,
  EstimateResource,
  EstimatesRequest,
  InvoiceResource,
  InvoicesRequest,
  ItemWarehouseStockResource,
  PimiaClientOptions,
  RateLimit,
  ReadOptions,
  RequestOptions,
  ResourceEnvelope,
  ResponseMeta,
  ResponseWithMeta,
  WarehouseRequest,
  WarehouseResource,
  WriteOptions,
} from './client.js'

export { OAuth, createPkceChallenge, createState } from './oauth.js'
export type {
  AuthorizationServerMetadata,
  AuthorizeUrlOptions,
  OAuthConfig,
  PkceChallenge,
} from './oauth.js'

export { MemoryTokenStore, isExpired, tokenSetFromResponse } from './tokens.js'
export type { TokenSet, TokenStore } from './tokens.js'

export {
  DuplicateExternalRefError,
  ForbiddenError,
  MissingScopeError,
  NotAuthenticatedError,
  NotFoundError,
  OAuthError,
  PimiaApiError,
  PimiaError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from './errors.js'

export {
  WEBHOOK_DEFAULT_TOLERANCE_SECONDS,
  WEBHOOK_EVENTS,
  WEBHOOK_HEADERS,
  WEBHOOK_SIGNATURE_VERSION,
  WebhookVerificationError,
  isWebhookEvent,
  signWebhook,
  verifyWebhook,
} from './webhooks.js'
export type {
  ApprovalDecidedPayload,
  AppRevokedPayload,
  CustomerPayload,
  EstimateAcceptedPayload,
  ExternalRef,
  InvoiceCreatedPayload,
  InvoicePaidPayload,
  InvoiceReceivedPayload,
  IsoDateTime,
  KnownWebhook,
  PimiaWebhook,
  SignWebhookOptions,
  UnknownWebhook,
  VerifyWebhookOptions,
  WebhookBodyInput,
  WebhookEvent,
  WebhookHeadersInput,
  WebhookPayloads,
  WebhookVerificationReason,
} from './webhooks.js'

/** Scopes granulares del catálogo de Pimia (paso 4). Pide siempre lo mínimo. */
export const SCOPES = {
  invoicesRead: 'invoices:read',
  invoicesWrite: 'invoices:write',
  estimatesRead: 'estimates:read',
  estimatesWrite: 'estimates:write',
  /** Leer contratos de servicio: periodo, estado, sus recurrentes. */
  contractsRead: 'contracts:read',
  /**
   * Gestionar contratos: crear, activar, renovar y cancelar — pueden
   * comprometer periodos de facturación futuros. Activar exige además
   * `invoices:write` (la recurrente que nace emitirá facturas por su cuenta).
   */
  contractsWrite: 'contracts:write',
  customersRead: 'customers:read',
  customersWrite: 'customers:write',
  expensesRead: 'expenses:read',
  expensesWrite: 'expenses:write',
  paymentsRead: 'payments:read',
  paymentsWrite: 'payments:write',
  itemsRead: 'items:read',
  itemsWrite: 'items:write',
  bankingRead: 'banking:read',
  bankingWrite: 'banking:write',
  crmRead: 'crm:read',
  crmWrite: 'crm:write',
  agendaRead: 'agenda:read',
  agendaWrite: 'agenda:write',
  reportsRead: 'reports:read',
  /** Leer la configuración de la empresa (impuestos, preferencias, series). */
  settingsRead: 'settings:read',
  /**
   * Configurar la empresa: impuestos, preferencias, campos personalizados y el
   * perfil del propio usuario (`PUT /me`). Ojo con ese último: cambiar el
   * correo o la contraseña exige además `current_password`, que es del usuario
   * y no tuya.
   */
  settingsWrite: 'settings:write',
  /** Cerrar y reabrir los trimestres fiscales del tenant. */
  reportsWrite: 'reports:write',
  /** Ver la tienda de módulos y qué tiene contratado el tenant. */
  storeRead: 'store:read',
  /** Instalar módulos de la tienda en el tenant. */
  storeWrite: 'store:write',
  /** Leer documentos con IA (OCR de gastos y de facturas recibidas). */
  ocrWrite: 'ocr:write',
  /** Leer la gestión de personal: empleados, ausencias, fichajes, calendarios. */
  hrRead: 'hr:read',
  /** Gestionar el personal: altas, ausencias, correcciones de fichaje, horarios. */
  hrWrite: 'hr:write',
  /** Gestionar los avisos (webhooks) que recibe tu app. */
  webhooksWrite: 'webhooks:write',
  /**
   * Proponer cambios que el dueño del tenant aprueba antes de aplicarse.
   * `approvalsSubmit` es un alias del mismo permiso, aceptado por el
   * Authorization Server.
   */
  approvalsWrite: 'approvals:write',
  approvalsSubmit: 'approvals:submit',
} as const

export type Scope = (typeof SCOPES)[keyof typeof SCOPES]
