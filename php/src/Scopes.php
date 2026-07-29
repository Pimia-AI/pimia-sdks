<?php

declare(strict_types=1);

namespace Pimia;

/**
 * Scopes granulares del catálogo de Pimia (paso 4 de la plataforma). Pide
 * siempre lo mínimo: el usuario ve cada permiso en el consentimiento y las
 * escrituras se le marcan aparte.
 */
final class Scopes
{
    public const INVOICES_READ = 'invoices:read';

    public const INVOICES_WRITE = 'invoices:write';

    public const ESTIMATES_READ = 'estimates:read';

    public const ESTIMATES_WRITE = 'estimates:write';

    public const CUSTOMERS_READ = 'customers:read';

    public const CUSTOMERS_WRITE = 'customers:write';

    public const EXPENSES_READ = 'expenses:read';

    public const EXPENSES_WRITE = 'expenses:write';

    public const PAYMENTS_READ = 'payments:read';

    public const PAYMENTS_WRITE = 'payments:write';

    public const ITEMS_READ = 'items:read';

    public const ITEMS_WRITE = 'items:write';

    public const BANKING_READ = 'banking:read';

    public const BANKING_WRITE = 'banking:write';

    public const CRM_READ = 'crm:read';

    public const CRM_WRITE = 'crm:write';

    public const AGENDA_READ = 'agenda:read';

    public const AGENDA_WRITE = 'agenda:write';

    /** Solo lectura: el dominio incluye escrituras que no son de partner. */
    public const REPORTS_READ = 'reports:read';

    private function __construct()
    {
    }
}
