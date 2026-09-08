<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/**
 * Lo que el CRM de Pimia publica para que OTRO CRM pueda sustituirlo.
 *
 * No es el recurso de los leads: ésos los sirve `/crm/leads` y un integrador que
 * trae su propio embudo no los usa. Aquí está lo que un CRM sustituto necesita
 * del núcleo aunque se haya llevado el embudo a su casa — hoy, el censo de a
 * quién se le puede asignar trabajo.
 */
final class Crm
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /**
     * Las personas a las que se les puede asignar una tarea o un lead.
     *
     * ── Por qué la pide un CRM que ya no es el de Pimia ─────────────────────
     *
     * Porque el censo vive donde viven los usuarios, y ése sigue siendo el
     * núcleo. Recortarlo tú es aplicar dos veces la misma política desde dos
     * sitios que pueden divergir: Pimia esconde aquí a los superadmin de la
     * plataforma y a la gestoría dueña del tenant, y recorta cada fila a `id` y
     * `name`. Si mañana añade un campo para desempatar dos nombres iguales, tu
     * copia lo borraría sin que nadie entendiera por qué. **Reenvía lo que
     * conteste**, campos de más incluidos.
     *
     * ⚠️ El scope: el contrato publicado la cobra con `crm:read`, pero el
     * núcleo la abrió el 2026-09-08 a cualquier token válido de la empresa
     * —precisamente para que un integrador que SUSTITUYE el CRM no tenga que
     * pedir el scope del CRM que ya no usa—. Contra una instancia anterior a
     * ese cambio sigue haciendo falta `crm:read`, así que si tu app puede
     * hablar con instancias viejas, pídelo.
     *
     * @return mixed `array{data: list<array{id: int, name: string}>}`
     */
    public function assignableUsers(): mixed
    {
        return $this->client->get('/crm/assignable-users');
    }
}
