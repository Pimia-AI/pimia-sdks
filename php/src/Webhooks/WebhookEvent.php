<?php

declare(strict_types=1);

namespace Pimia\Webhooks;

/**
 * Catálogo de eventos v1 (`config/webhooks.php` del core).
 *
 * Suscribirse a uno que este SDK todavía no conozca no rompe nada: la firma se
 * verifica igual y {@see WebhookDelivery::$event} llega a `null` con el nombre
 * crudo en {@see WebhookDelivery::$eventName}.
 */
enum WebhookEvent: string
{
    /** Una decisión de aprobación delegada se resolvió. Plano tenant. */
    case ApprovalDecided = 'approval.decided';

    /** Alta de una factura recibida (libro de recibidas). */
    case InvoiceReceived = 'invoice.received';

    /** Un grant OAuth quedó revocado: deja de usar sus tokens. Plano tenant. */
    case AppRevoked = 'app.revoked';

    case CustomerCreated = 'customer.created';

    case CustomerUpdated = 'customer.updated';

    case InvoiceCreated = 'invoice.created';

    /** El CLIENTE FINAL aceptó el presupuesto. Transición, no estado. */
    case EstimateAccepted = 'estimate.accepted';

    /** La factura quedó cobrada del todo. `PARTIALLY_PAID` no emite. */
    case InvoicePaid = 'invoice.paid';
}
