<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/**
 * Oportunidades: a quién va dirigido un presupuesto.
 *
 * ── Por qué esto es la pieza que hace posible un CRM de fuera ───────────────
 *
 * `estimates.opportunity_id` es el enlace transparente del núcleo: funciona
 * venga el CRM de donde venga, y es lo que permite preguntar «los presupuestos
 * de este trato» sin que el trato viva en Pimia. Pero hasta el 2026-09-08 una
 * oportunidad **sólo podía nacer dentro de un `POST /estimates`**, así que un
 * CRM de fuera no tenía forma de estrenar una al dar de alta un lead: habría
 * tenido que fabricar un presupuesto borrador y quemar un número de la serie
 * del cliente por cada lead. Un lead no es una oferta.
 *
 * `POST /opportunities` es la puerta que se abrió para eso (galeote/factSaas#805).
 *
 * ⚠️ **Todavía no está en el spec publicado** (`spec/pimia-api-v1.json`, que va
 * a la última sincronización del contrato): la ruta es más nueva que esa foto.
 * Contra una instancia anterior a ella la llamada contesta 404, y eso es lo que
 * hay que mirar antes de dar por hecho que el token está mal.
 *
 * ── El scope ────────────────────────────────────────────────────────────────
 *
 * No estrena ninguno: cuelga del dominio `estimates` ({@see \Pimia\Scopes::ESTIMATES_WRITE}),
 * porque la oportunidad es a quién va dirigido un presupuesto y no una entidad
 * del embudo. Un integrador que sustituye el CRM no tiene que pedir `crm:write`
 * para estrenar las suyas.
 */
final class Opportunities
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /**
     * Estrena una oportunidad y devuelve la que se creó.
     *
     * ⛔ **Sólo la ficha de a quién va dirigida, y nada más.** La etapa, la
     * probabilidad y el importe esperado son del CRM que llama —Pimia no los
     * guarda—, así que mandarlos es un 422. Y está bien que lo sea: el día que
     * los aceptara callando, habría dos sitios donde vive el embudo.
     *
     * Pasa `$idempotencyKey` —una clave estable por lead, del estilo
     * `lead:{id}:opportunity`— y el reintento tras un timeout no te estrenará
     * una segunda oportunidad para el mismo trato.
     *
     * @param  array{name: string, contact_name?: ?string, email?: ?string, phone?: ?string}  $data
     * @return mixed `array{data: array<string, mixed>}`; el id, en `data.id`.
     */
    public function create(array $data, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post('/opportunities', $data, $idempotencyKey);
    }
}
