<?php

declare(strict_types=1);

namespace Pimia\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Pimia\Exception\WebhookVerificationException;
use Pimia\Webhooks\WebhookEvent;
use Pimia\Webhooks\WebhookVerifier;

/**
 * Tests del verificador de webhooks.
 *
 * El eje es el VECTOR DORADO: una entrega firmada con la misma definición de
 * canónico que usa el emisor del core (WebhookSigner.php), con acentos y una
 * barra en el cuerpo para que cualquier reescape de UTF-8 o de `/` rompa el
 * test. **El mismo vector está fijado en el SDK de TypeScript**
 * (typescript/test/webhooks.test.js): si los dos lo aceptan, los dos
 * reconstruyen el canónico igual.
 */
final class WebhookVerifierTest extends TestCase
{
    private const SECRET = 'whsec_prueba_del_vector_dorado';

    private const TIMESTAMP = 1786000000;

    private const EVENT = 'invoice.paid';

    private const DELIVERY = '918273';

    private const BODY = '{"id":42,"number":"FAC-2026/0007","status":"COMPLETED","paid_status":"PAID","is_credit_note":false,"customer_id":7,"company_id":1,"total":121000,"due_amount":0,"currency_id":1,"paid_at":"2026-08-10T12:34:56+02:00","nota":"Café con leche · 50% dto."}';

    private const SIGNATURE = 'sha256=5721ac76ed1acb6f509713027533c29442361485690f175591ab99f21876e86c';

    public function test_el_vector_dorado_se_verifica_y_trae_el_payload(): void
    {
        $hook = $this->verifier()->verify($this->headers(), self::BODY);

        $this->assertTrue($hook->isKnown());
        $this->assertSame(WebhookEvent::InvoicePaid, $hook->event);
        $this->assertSame('invoice.paid', $hook->eventName);
        $this->assertSame('918273', $hook->delivery);
        $this->assertSame(self::TIMESTAMP, $hook->timestamp);
        $this->assertSame(42, $hook->payload['id']);
        $this->assertSame(121000, $hook->payload['total']);
        // Los acentos y el `·` sobreviven al viaje por bytes.
        $this->assertSame('Café con leche · 50% dto.', $hook->payload['nota']);
    }

    public function test_el_canonico_coincide_con_el_del_emisor_del_core(): void
    {
        // Reproducción literal de App\Services\Webhooks\WebhookSigner::canonical:
        // si el core cambiara el canónico, este test lo caza antes que un
        // integrador.
        $canonical = implode("\n", [
            'PIMIA-WEBHOOK-v1',
            (string) self::TIMESTAMP,
            self::EVENT,
            self::DELIVERY,
            self::BODY,
        ]);

        $this->assertSame(
            self::SIGNATURE,
            'sha256='.hash_hmac('sha256', $canonical, self::SECRET),
        );
    }

    public function test_reserializar_el_cuerpo_rompe_la_firma(): void
    {
        // Mismo array, otros bytes: lo que pasa si el receptor firma
        // json_encode($request->all()) en vez del cuerpo crudo.
        $reserializado = json_encode(json_decode(self::BODY, true), JSON_PRETTY_PRINT);
        $this->assertIsString($reserializado);

        $this->assertRechaza(
            WebhookVerificationException::REASON_SIGNATURE_MISMATCH,
            fn () => $this->verifier()->verify($this->headers(), $reserializado),
        );
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function cabecerasObligatorias(): iterable
    {
        yield 'firma' => ['x-pimia-signature'];
        yield 'timestamp' => ['x-pimia-timestamp'];
        yield 'evento' => ['x-pimia-event'];
        yield 'entrega' => ['x-pimia-delivery'];
    }

    #[DataProvider('cabecerasObligatorias')]
    public function test_faltar_una_cabecera_es_un_rechazo(string $cabecera): void
    {
        $headers = $this->headers();
        unset($headers[$cabecera]);

        $this->assertRechaza(
            WebhookVerificationException::REASON_MISSING_HEADERS,
            fn () => $this->verifier()->verify($headers, self::BODY),
        );
    }

    public function test_un_timestamp_que_no_es_numero_se_rechaza(): void
    {
        $this->assertRechaza(
            WebhookVerificationException::REASON_INVALID_TIMESTAMP,
            fn () => $this->verifier()->verify($this->headers(['x-pimia-timestamp' => 'ayer']), self::BODY),
        );
    }

    public function test_una_entrega_vieja_se_rechaza_por_replay(): void
    {
        $this->assertRechaza(
            WebhookVerificationException::REASON_TIMESTAMP_OUT_OF_WINDOW,
            fn () => $this->verifier(self::TIMESTAMP + 360)->verify($this->headers(), self::BODY),
        );
    }

    public function test_el_desfase_se_mide_en_valor_absoluto(): void
    {
        // Reloj del receptor atrasado: también fuera de ventana.
        $this->assertRechaza(
            WebhookVerificationException::REASON_TIMESTAMP_OUT_OF_WINDOW,
            fn () => $this->verifier(self::TIMESTAMP - 360)->verify($this->headers(), self::BODY),
        );
    }

    public function test_justo_en_el_borde_de_la_ventana_todavia_entra(): void
    {
        $hook = $this->verifier(self::TIMESTAMP + 300)->verify($this->headers(), self::BODY);

        $this->assertTrue($hook->isKnown());
    }

    public function test_la_tolerancia_es_configurable(): void
    {
        $verifier = new WebhookVerifier(
            self::SECRET,
            toleranceSeconds: 900,
            clock: static fn (): int => self::TIMESTAMP + 600,
        );

        $this->assertSame(
            WebhookEvent::InvoicePaid,
            $verifier->verify($this->headers(), self::BODY)->event,
        );
    }

    public function test_una_firma_manipulada_no_cuela(): void
    {
        $alterada = substr(self::SIGNATURE, 0, -1).(str_ends_with(self::SIGNATURE, 'c') ? 'd' : 'c');

        $this->assertRechaza(
            WebhookVerificationException::REASON_SIGNATURE_MISMATCH,
            fn () => $this->verifier()->verify($this->headers(['x-pimia-signature' => $alterada]), self::BODY),
        );
    }

    public function test_una_firma_de_otra_longitud_no_revienta(): void
    {
        $this->assertRechaza(
            WebhookVerificationException::REASON_SIGNATURE_MISMATCH,
            fn () => $this->verifier()->verify($this->headers(['x-pimia-signature' => 'sha256=00']), self::BODY),
        );
    }

    public function test_sin_el_prefijo_del_algoritmo_tampoco_vale(): void
    {
        $sinPrefijo = str_replace('sha256=', '', self::SIGNATURE);

        $this->assertRechaza(
            WebhookVerificationException::REASON_SIGNATURE_MISMATCH,
            fn () => $this->verifier()->verify($this->headers(['x-pimia-signature' => $sinPrefijo]), self::BODY),
        );
    }

    public function test_el_secreto_equivocado_se_rechaza(): void
    {
        $verifier = new WebhookVerifier('whsec_otro', clock: static fn (): int => self::TIMESTAMP);

        $this->assertRechaza(
            WebhookVerificationException::REASON_SIGNATURE_MISMATCH,
            fn () => $verifier->verify($this->headers(), self::BODY),
        );
    }

    public function test_una_lista_de_secretos_permite_rotar_sin_caida(): void
    {
        $verifier = new WebhookVerifier(
            ['whsec_el_nuevo_que_aun_no_esta_en_el_panel', self::SECRET],
            clock: static fn (): int => self::TIMESTAMP,
        );

        $this->assertSame(
            WebhookEvent::InvoicePaid,
            $verifier->verify($this->headers(), self::BODY)->event,
        );
    }

    public function test_si_ningun_secreto_de_la_lista_vale_se_rechaza(): void
    {
        $verifier = new WebhookVerifier(
            ['whsec_uno', 'whsec_dos'],
            clock: static fn (): int => self::TIMESTAMP,
        );

        $this->assertRechaza(
            WebhookVerificationException::REASON_SIGNATURE_MISMATCH,
            fn () => $verifier->verify($this->headers(), self::BODY),
        );
    }

    public function test_un_evento_desconocido_se_verifica_igual(): void
    {
        // El catálogo del servidor puede crecer sin que el partner actualice el
        // SDK: eso no puede convertirse en un 400.
        $cuerpo = '{"id":1,"algo":"nuevo"}';
        $headers = WebhookVerifier::sign(self::SECRET, 'invoice.overdue', 5, $cuerpo, self::TIMESTAMP);

        $hook = $this->verifier()->verify($headers, $cuerpo);

        $this->assertFalse($hook->isKnown());
        $this->assertNull($hook->event);
        $this->assertSame('invoice.overdue', $hook->eventName);
        $this->assertSame('5', $hook->delivery);
        $this->assertSame(['id' => 1, 'algo' => 'nuevo'], $hook->payload);
    }

    public function test_los_ocho_eventos_del_catalogo_se_reconocen(): void
    {
        $catalogo = [
            'approval.decided',
            'invoice.received',
            'app.revoked',
            'customer.created',
            'customer.updated',
            'invoice.created',
            'estimate.accepted',
            'invoice.paid',
        ];

        foreach ($catalogo as $evento) {
            $cuerpo = '{"id":1}';
            $headers = WebhookVerifier::sign(self::SECRET, $evento, 1, $cuerpo, self::TIMESTAMP);
            $hook = $this->verifier()->verify($headers, $cuerpo);

            $this->assertTrue($hook->isKnown(), "{$evento} debería estar en el catálogo");
            $this->assertSame($evento, $hook->event?->value);
        }

        // Y el enum no tiene de más: ocho, ni uno más.
        $this->assertCount(8, WebhookEvent::cases());
    }

    public function test_firma_valida_pero_cuerpo_que_no_es_json(): void
    {
        $cuerpo = 'esto no es json';
        $headers = WebhookVerifier::sign(self::SECRET, self::EVENT, 9, $cuerpo, self::TIMESTAMP);

        $this->assertRechaza(
            WebhookVerificationException::REASON_INVALID_JSON,
            fn () => $this->verifier()->verify($headers, $cuerpo),
        );
    }

    public function test_las_cabeceras_se_leen_como_las_da_laravel(): void
    {
        // Symfony/Laravel entrega cada cabecera como lista de valores, y un
        // proxy puede no respetar las minúsculas.
        $headers = [
            'X-Pimia-Signature' => [self::SIGNATURE],
            'X-PIMIA-TIMESTAMP' => [(string) self::TIMESTAMP],
            'x-pimia-event' => [self::EVENT],
            'X-Pimia-Delivery' => [self::DELIVERY, '999'],
        ];

        $hook = $this->verifier()->verify($headers, self::BODY);

        $this->assertSame(WebhookEvent::InvoicePaid, $hook->event);
        $this->assertSame(self::DELIVERY, $hook->delivery);
    }

    public function test_sign_produce_exactamente_lo_que_verify_espera(): void
    {
        $cuerpo = json_encode(['id' => 7, 'nota' => 'ñandú'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $this->assertIsString($cuerpo);

        $headers = WebhookVerifier::sign(self::SECRET, 'estimate.accepted', 4242, $cuerpo, self::TIMESTAMP);
        $hook = $this->verifier()->verify($headers, $cuerpo);

        $this->assertSame(WebhookEvent::EstimateAccepted, $hook->event);
        $this->assertSame('4242', $hook->delivery);
        $this->assertSame('ñandú', $hook->payload['nota']);
    }

    public function test_sign_reproduce_el_vector_dorado(): void
    {
        $headers = WebhookVerifier::sign(
            self::SECRET,
            self::EVENT,
            self::DELIVERY,
            self::BODY,
            self::TIMESTAMP,
        );

        $this->assertSame(self::SIGNATURE, $headers['x-pimia-signature']);
        $this->assertSame((string) self::TIMESTAMP, $headers['x-pimia-timestamp']);
        $this->assertSame(self::EVENT, $headers['x-pimia-event']);
        $this->assertSame(self::DELIVERY, $headers['x-pimia-delivery']);
    }

    private function verifier(?int $now = null): WebhookVerifier
    {
        $instante = $now ?? self::TIMESTAMP;

        return new WebhookVerifier(self::SECRET, clock: static fn (): int => $instante);
    }

    /**
     * @param  array<string, string>  $cambios
     * @return array<string, string>
     */
    private function headers(array $cambios = []): array
    {
        return array_merge([
            'x-pimia-signature' => self::SIGNATURE,
            'x-pimia-timestamp' => (string) self::TIMESTAMP,
            'x-pimia-event' => self::EVENT,
            'x-pimia-delivery' => self::DELIVERY,
        ], $cambios);
    }

    /**
     * Rechazo con un `reason` concreto. No basta con que lance: el `reason` es
     * parte del contrato —distingue «me están atacando» de «tengo el reloj
     * mal»— y un test que solo mire la clase lo dejaría derivar.
     */
    private function assertRechaza(string $reason, callable $accion): void
    {
        try {
            $accion();
        } catch (WebhookVerificationException $e) {
            $this->assertSame($reason, $e->reason);

            return;
        }

        $this->fail("Se esperaba un rechazo con reason={$reason}, pero no hubo excepción.");
    }
}
