<?php

declare(strict_types=1);

namespace Pimia\Exception;

/**
 * La entrega no es de Pimia, o no es fresca, o no es JSON.
 *
 * Contesta `400` y no proceses nada. Una racha de estas con
 * `REASON_SIGNATURE_MISMATCH` es la señal de que el secreto de tu endpoint y
 * el del panel han dejado de coincidir.
 */
class WebhookVerificationException extends PimiaException
{
    public const REASON_MISSING_HEADERS = 'missing_headers';

    public const REASON_INVALID_TIMESTAMP = 'invalid_timestamp';

    public const REASON_TIMESTAMP_OUT_OF_WINDOW = 'timestamp_out_of_window';

    public const REASON_SIGNATURE_MISMATCH = 'signature_mismatch';

    public const REASON_INVALID_JSON = 'invalid_json';

    /**
     * @param  string  $reason  Uno de los `REASON_*`. Legible por máquina, para
     *                          tus métricas: distinguir «me están atacando» de
     *                          «tengo el reloj mal» importa.
     */
    public function __construct(
        public readonly string $reason,
        string $message,
    ) {
        parent::__construct($message);
    }
}
