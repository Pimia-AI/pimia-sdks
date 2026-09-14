<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/**
 * La suscripción del CLIENTE en el Stripe de su integrador (`/api/v1` 1.1.0,
 * galeote/factSaas#835 parte B): lo que un integrador que cobra con Stripe
 * enseña en el perfil de su cliente para cambiar de plan o darse de baja.
 *
 * ── Scopes y quién puede ────────────────────────────────────────────────────
 *
 * {@see \Pimia\Scopes::INTEGRADOR_BILLING_READ} y
 * {@see \Pimia\Scopes::INTEGRADOR_BILLING_WRITE}, que no dan acceso a la
 * facturación de Pimia. Además el usuario del token tiene que ser dueño o
 * administrador de la empresa (403 si no). Siguen abiertas con la instancia
 * suspendida.
 *
 * ── Lo que no hay, a propósito ──────────────────────────────────────────────
 *
 * Ni `cancel` ni `changePlan`: todo pasa por el portal de Stripe. Subir de plan
 * es inmediato y cobra la diferencia; bajar o cancelar se aplica al final del
 * periodo, y la lectura no anuncia las bajadas pendientes.
 *
 * ── Los cortes ──────────────────────────────────────────────────────────────
 *
 * Llegan en `code` del cuerpo ({@see \Pimia\Exception\ApiException::$body}):
 * 404 `suscripcion_no_disponible`; 409 `suscripcion_de_baja`,
 * `suscripcion_modificada` o `stripe_plan_unknown`; y en el portal, 422
 * `return_url_no_permitida` y 503 `stripe_unavailable` (reintentar).
 */
final class IntegradorBilling
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /**
     * `GET /billing/integrador/subscription`: los planes publicados de la
     * vertical (`planes`, `currency`), el estado en Stripe (`stripe_status`,
     * `cancel_at_period_end`, `current_period_end`), la mora (`debe_desde`,
     * `baja_en`) y lo contratado hoy (`hoy`).
     *
     * @return mixed `array{data: array<string, mixed>}`
     */
    public function subscription(): mixed
    {
        return $this->client->get('/billing/integrador/subscription');
    }

    /**
     * `POST /billing/integrador/portal`: la URL del portal de Stripe para esta
     * suscripción, en `data.url`. Redirige a ella en el momento: la sesión del
     * portal caduca pronto, así que no la guardes.
     *
     * @param  string  $returnUrl  A dónde vuelve el cliente. Tiene que ser de uno
     *                             de los orígenes registrados de la app de su
     *                             vertical; si no, 422 `return_url_no_permitida`.
     * @return mixed `array{data: array{url: string}}`
     */
    public function portal(string $returnUrl): mixed
    {
        return $this->client->post('/billing/integrador/portal', ['return_url' => $returnUrl]);
    }
}
