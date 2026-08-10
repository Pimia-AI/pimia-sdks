<?php

declare(strict_types=1);

namespace Pimia\Webhooks;

use Pimia\Exception\WebhookVerificationException;

/**
 * Verificación de la firma PIMIA-WEBHOOK-v1 de los webhooks entrantes.
 *
 * Existe porque sin esto cada integrador reescribe el mismo HMAC a mano —y con
 * él las mismas tres trampas—: firmar el JSON reserializado en vez de los bytes
 * recibidos, comparar la firma con `===`, y olvidar la ventana anti-replay.
 *
 * ```php
 * $verifier = new WebhookVerifier(getenv('PIMIA_WEBHOOK_SECRET'));
 *
 * try {
 *     // OJO: el cuerpo CRUDO. En Laravel, $request->getContent().
 *     $hook = $verifier->verify($request->headers->all(), $request->getContent());
 * } catch (WebhookVerificationException $e) {
 *     return response($e->reason, 400);
 * }
 *
 * // Idempotencia: la MISMA entrega reintentada llega con el mismo id.
 * if ($yaProcesado($hook->delivery)) {
 *     return response('', 200);
 * }
 *
 * match ($hook->event) {
 *     WebhookEvent::EstimateAccepted => $facturar($hook->payload['id']),
 *     WebhookEvent::InvoicePaid      => $cobrar($hook->payload['id']),
 *     default                        => null, // incluye el catálogo futuro
 * };
 *
 * return response('', 200); // responde rápido: el trabajo pesado, a una cola
 * ```
 */
final class WebhookVerifier
{
    /** Versión del canónico firmado. Primera línea de lo que pasa por el HMAC. */
    public const SIGNATURE_VERSION = 'PIMIA-WEBHOOK-v1';

    public const SIGNATURE_HEADER = 'x-pimia-signature';

    public const TIMESTAMP_HEADER = 'x-pimia-timestamp';

    public const EVENT_HEADER = 'x-pimia-event';

    public const DELIVERY_HEADER = 'x-pimia-delivery';

    /** Ventana anti-replay por defecto, en segundos: la misma que el emisor. */
    public const DEFAULT_TOLERANCE_SECONDS = 300;

    /** @var list<string> */
    private readonly array $secrets;

    /**
     * @param  string|list<string>  $secret  Secreto del endpoint (el del panel
     *                                       de Pimia). Acepta una lista para
     *                                       poder rotarlo sin ventana de caída:
     *                                       durante el cambio, valen los dos.
     * @param  int  $toleranceSeconds  Ventana anti-replay.
     * @param  (\Closure(): int)|null  $clock  Reloj en segundos epoch.
     *                                         Inyectable solo para tests.
     */
    public function __construct(
        string|array $secret,
        private readonly int $toleranceSeconds = self::DEFAULT_TOLERANCE_SECONDS,
        private readonly ?\Closure $clock = null,
    ) {
        $this->secrets = is_string($secret) ? [$secret] : array_values($secret);
    }

    /**
     * Verifica una entrega y devuelve el evento con su payload.
     *
     * ⚠️ **`$body` tiene que ser el cuerpo TAL Y COMO LLEGÓ.** Pimia firma
     * exactamente el JSON que envía: parsear y volver a serializar produce un
     * array equivalente pero otros bytes, y la firma deja de cuadrar sin que se
     * vea por qué. En Laravel eso es `$request->getContent()`, nunca
     * `json_encode($request->all())`.
     *
     * Qué comprueba, en este orden: que estén las cuatro cabeceras, que el
     * timestamp sea un número dentro de la ventana anti-replay, que el
     * HMAC-SHA256 del canónico coincida (`hash_equals`, tiempo constante) y que
     * el cuerpo sea JSON.
     *
     * Lo que NO hace, porque es tuyo: deduplicar por `delivery`. Pimia
     * reintenta hasta cinco veces con backoff, así que una entrega puede
     * llegarte más de una vez con la misma firma válida.
     *
     * @param  array<string, string|list<string>|null>  $headers  Se leen sin
     *                                                            distinguir
     *                                                            mayúsculas, y
     *                                                            se acepta la
     *                                                            forma de
     *                                                            Symfony/Laravel
     *                                                            (cada valor,
     *                                                            un array).
     *
     * @throws WebhookVerificationException
     */
    public function verify(array $headers, string $body): WebhookDelivery
    {
        $signature = $this->header($headers, self::SIGNATURE_HEADER);
        $timestampRaw = $this->header($headers, self::TIMESTAMP_HEADER);
        $event = $this->header($headers, self::EVENT_HEADER);
        $delivery = $this->header($headers, self::DELIVERY_HEADER);

        if ($signature === null || $timestampRaw === null || $event === null || $delivery === null) {
            throw new WebhookVerificationException(
                WebhookVerificationException::REASON_MISSING_HEADERS,
                'Faltan cabeceras de firma: se esperan x-pimia-signature, x-pimia-timestamp, x-pimia-event y x-pimia-delivery.',
            );
        }

        if (! is_numeric($timestampRaw)) {
            throw new WebhookVerificationException(
                WebhookVerificationException::REASON_INVALID_TIMESTAMP,
                "La cabecera x-pimia-timestamp no es un número: {$timestampRaw}",
            );
        }

        $timestamp = (int) $timestampRaw;
        $now = $this->clock !== null ? ($this->clock)() : time();
        $age = abs($now - $timestamp);

        if ($age > $this->toleranceSeconds) {
            throw new WebhookVerificationException(
                WebhookVerificationException::REASON_TIMESTAMP_OUT_OF_WINDOW,
                "Entrega fuera de la ventana anti-replay: {$age}s de desfase, el máximo es {$this->toleranceSeconds}s.",
            );
        }

        $canonical = self::canonical($timestampRaw, $event, $delivery, $body);
        $matches = false;

        foreach ($this->secrets as $secret) {
            $expected = 'sha256='.hash_hmac('sha256', $canonical, $secret);
            // Sin cortocircuito: se comprueban todos los secretos siempre, para
            // que el tiempo de respuesta no diga cuál de ellos acertó.
            $matches = hash_equals($expected, $signature) || $matches;
        }

        if (! $matches) {
            throw new WebhookVerificationException(
                WebhookVerificationException::REASON_SIGNATURE_MISMATCH,
                'La firma no coincide: la entrega no viene de Pimia, o el secreto del endpoint no es el que crees, o el cuerpo se reserializó por el camino.',
            );
        }

        try {
            $payload = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new WebhookVerificationException(
                WebhookVerificationException::REASON_INVALID_JSON,
                'La firma es válida pero el cuerpo no es JSON. No debería pasar: repórtalo.',
            );
        }

        if (! is_array($payload)) {
            throw new WebhookVerificationException(
                WebhookVerificationException::REASON_INVALID_JSON,
                'La firma es válida pero el cuerpo no es un objeto JSON. No debería pasar: repórtalo.',
            );
        }

        return new WebhookDelivery(
            WebhookEvent::tryFrom($event),
            $event,
            $delivery,
            $timestamp,
            $payload,
        );
    }

    /**
     * Firma un cuerpo como lo haría Pimia y devuelve sus cuatro cabeceras.
     *
     * Está aquí **para que puedas testear tu receptor** sin reimplementar el
     * HMAC —que es justo lo que esta clase viene a evitar—: monta el cuerpo que
     * esperas, fírmalo y mándaselo a tu handler. En producción no lo necesitas:
     * quien firma es Pimia.
     *
     * @return array<string, string>
     */
    public static function sign(
        string $secret,
        string $event,
        int|string $deliveryId,
        string $body,
        ?int $timestamp = null,
    ): array {
        $timestamp ??= time();
        $delivery = (string) $deliveryId;
        $canonical = self::canonical((string) $timestamp, $event, $delivery, $body);

        return [
            self::SIGNATURE_HEADER => 'sha256='.hash_hmac('sha256', $canonical, $secret),
            self::TIMESTAMP_HEADER => (string) $timestamp,
            self::EVENT_HEADER => $event,
            self::DELIVERY_HEADER => $delivery,
        ];
    }

    /**
     * El canónico: versión, timestamp, evento e id de entrega, y el cuerpo
     * EXACTO, unidos por `\n`. Byte a byte lo mismo que arma el emisor
     * (`App\Services\Webhooks\WebhookSigner::canonical`).
     */
    private static function canonical(
        string $timestamp,
        string $event,
        string $delivery,
        string $body,
    ): string {
        return implode("\n", [self::SIGNATURE_VERSION, $timestamp, $event, $delivery, $body]);
    }

    /**
     * Lee una cabecera sin distinguir mayúsculas y aguantando las dos formas
     * habituales: valor suelto (PSR-7 `getHeaderLine`, `$_SERVER` normalizado)
     * o lista de valores (Symfony/Laravel `headers->all()`).
     *
     * @param  array<string, string|list<string>|null>  $headers
     */
    private function header(array $headers, string $name): ?string
    {
        $value = null;

        foreach ($headers as $key => $candidate) {
            if (strcasecmp($key, $name) === 0) {
                $value = $candidate;
                break;
            }
        }

        if (is_array($value)) {
            $value = $value[0] ?? null;
        }

        return $value === null || $value === '' ? null : (string) $value;
    }
}
