<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/**
 * Facturación vista desde la instancia.
 *
 * Hoy solo cuelga de aquí {@see IntegradorBilling}: la suscripción del cliente
 * en el Stripe de SU integrador. La facturación de Pimia (`billing:*`) está
 * reservada a la primera parte y no tiene recurso en este SDK.
 */
final class Billing
{
    public readonly IntegradorBilling $integrador;

    public function __construct(PimiaClient $client)
    {
        $this->integrador = new IntegradorBilling($client);
    }
}
