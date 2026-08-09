<?php

declare(strict_types=1);

namespace Pimia\Http;

/**
 * Lo que la respuesta dice ADEMÁS del cuerpo.
 *
 * Va por petición y no como estado del cliente —al contrario que
 * `PimiaClient::rateLimit()`— a propósito: `idempotentReplay` solo significa
 * algo referido a UNA llamada concreta, y justo se consulta cuando hay
 * reintentos, que es cuando puede haber varias en vuelo. Un campo compartido
 * en el cliente daría la respuesta de otra.
 */
final class ResponseMeta
{
    /**
     * @param  bool  $idempotentReplay  `true` si Pimia reprodujo la respuesta
     *                                  de una petición anterior con la misma
     *                                  `Idempotency-Key` en vez de volver a
     *                                  escribir. Es la diferencia entre «he
     *                                  creado la factura» y «ya estaba
     *                                  creada»: sin esto, un partner no puede
     *                                  distinguirlas en sus propios registros.
     * @param  array{limit?: int, remaining?: int}  $rateLimit
     */
    public function __construct(
        public readonly int $status,
        public readonly bool $idempotentReplay,
        public readonly ?string $requestId,
        public readonly array $rateLimit,
    ) {
    }
}
