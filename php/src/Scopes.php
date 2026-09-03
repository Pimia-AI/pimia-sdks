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

    /**
     * Leer las OPORTUNIDADES: leads, su embudo y su actividad comercial.
     *
     * ⚠️ Desde la 0.20.0 ya NO alcanza proyectos, tareas ni partes de horas:
     * eso es `work:read` (núcleo galeote/factSaas#677). Un grant vivo que solo
     * pidió `crm:*` tiene que reconectar para recuperarlos.
     */
    public const CRM_READ = 'crm:read';

    /** Crear y modificar leads, moverlos de etapa y convertirlos en cliente. */
    public const CRM_WRITE = 'crm:write';

    /** Leer el trabajo: obras y proyectos, tareas y partes de horas. */
    public const WORK_READ = 'work:read';

    /** Crear y modificar obras y proyectos, tareas y partes de horas. */
    public const WORK_WRITE = 'work:write';

    /**
     * Leer la campana: tareas vencidas, ausencias y correcciones de fichaje.
     *
     * ⚠️ Desde la 0.21.0 `/notifications` tiene dominio propio y `crm:read` ya
     * no lo alcanza (núcleo galeote/factSaas#677). Lo que la campana lleva lo
     * emiten los módulos de Trabajo y de Personal, no el embudo comercial.
     */
    public const NOTIFICATIONS_READ = 'notifications:read';

    /** Marcar avisos como leídos y borrarlos. */
    public const NOTIFICATIONS_WRITE = 'notifications:write';

    public const AGENDA_READ = 'agenda:read';

    public const AGENDA_WRITE = 'agenda:write';

    /** Leer contratos de servicio: periodo, estado, sus recurrentes. */
    public const CONTRACTS_READ = 'contracts:read';

    /**
     * Gestionar contratos: crear, activar, renovar y cancelar — pueden
     * comprometer periodos de facturación futuros. Activar exige además
     * `invoices:write` (la recurrente que nace emitirá facturas).
     */
    public const CONTRACTS_WRITE = 'contracts:write';

    /** Solo lectura: el dominio incluye escrituras que no son de partner. */
    public const REPORTS_READ = 'reports:read';

    /** Leer la configuración de la empresa (impuestos, preferencias, series). */
    public const SETTINGS_READ = 'settings:read';

    /**
     * Configurar la empresa: impuestos, preferencias, campos personalizados y el
     * perfil del propio usuario (`PUT /me`). Ojo con ese último: cambiar el
     * correo o la contraseña exige además `current_password`, que es del usuario
     * y no tuya.
     */
    public const SETTINGS_WRITE = 'settings:write';

    /** Cerrar y reabrir los trimestres fiscales del tenant. */
    public const REPORTS_WRITE = 'reports:write';

    /** Ver la tienda de módulos y qué tiene contratado el tenant. */
    public const STORE_READ = 'store:read';

    /** Instalar módulos de la tienda en el tenant. */
    public const STORE_WRITE = 'store:write';

    /** Leer documentos con IA (OCR de gastos y de facturas recibidas). */
    public const OCR_WRITE = 'ocr:write';

    /** Leer la gestión de personal: empleados, ausencias, fichajes, calendarios. */
    public const HR_READ = 'hr:read';

    /** Gestionar el personal: altas, ausencias, correcciones de fichaje, horarios. */
    public const HR_WRITE = 'hr:write';

    /** Gestionar los avisos (webhooks) que recibe tu app. */
    public const WEBHOOKS_WRITE = 'webhooks:write';

    /**
     * Proponer cambios que el dueño del tenant aprueba antes de aplicarse.
     * `APPROVALS_SUBMIT` es un alias del mismo permiso, aceptado por el
     * Authorization Server.
     */
    public const APPROVALS_WRITE = 'approvals:write';

    public const APPROVALS_SUBMIT = 'approvals:submit';

    private function __construct()
    {
    }
}
