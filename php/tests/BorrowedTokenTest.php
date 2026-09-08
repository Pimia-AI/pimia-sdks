<?php

declare(strict_types=1);

namespace Pimia\Tests;

use PHPUnit\Framework\TestCase;
use Pimia\Exception\NotAuthenticatedException;
use Pimia\Exception\PimiaException;
use Pimia\Exception\UnauthorizedException;
use Pimia\OAuth\BorrowedTokenStore;
use Pimia\OAuth\TokenSet;
use Pimia\PimiaClient;

/**
 * El modo «token prestado»: un cliente que reenvía el `Authorization` de otro.
 *
 * Foco: que **no posea nada**. Sin ceremonia OAuth, sin store que persistir y
 * —lo que más importa— sin intentar refrescar un grant que no es suyo. Un
 * refresco ahí no sería un fallo educado: con la rotación de Pimia, reusar el
 * refresh de otro revoca su grant entero en cascada.
 */
final class BorrowedTokenTest extends TestCase
{
    private const BASE = 'https://acme.pimia.es';

    public function test_reenvia_el_bearer_prestado_y_no_monta_ceremonia_oauth(): void
    {
        $transport = new FakeTransport(static fn () => FakeTransport::json(['data' => []]));

        $client = PimiaClient::withBorrowedToken(self::BASE, 'el-token-de-ana', $transport);

        $client->get('/customers');

        $this->assertSame('Bearer el-token-de-ana', $transport->calls[0]['headers']['authorization']);
        $this->assertSame(self::BASE.'/api/v1/customers', $transport->calls[0]['url']);

        // Y `oauth` es null, no un OAuthClient a medias: sin clientId, una URL
        // de autorización saldría con `client_id=` vacío y el fallo aparecería
        // en el navegador del usuario, lejos de aquí.
        $this->assertNull($client->oauth);
    }

    /** Las cabeceras fijas viajan en cada llamada; sin ellas, no se manda ninguna. */
    public function test_las_cabeceras_fijas_viajan_y_omitirlas_no_manda_nada(): void
    {
        $transport = new FakeTransport(static fn () => FakeTransport::json([]));

        PimiaClient::withBorrowedToken(self::BASE, 'at', $transport, ['company' => '7'])->get('/bootstrap');
        PimiaClient::withBorrowedToken(self::BASE, 'at', $transport)->get('/bootstrap');

        $this->assertSame('7', $transport->calls[0]['headers']['company']);
        $this->assertArrayNotHasKey('company', $transport->calls[1]['headers']);
    }

    /**
     * ⛔ EL TEST DE ESTE FICHERO: un 401 con un token prestado NO dispara un
     * refresco.
     *
     * Con grant propio, el cliente refresca y reintenta —hay un test suyo en
     * `PimiaClientTest`—. Aquí no hay refresh token que usar, así que el 401
     * tiene que subir tal cual **y con una sola llamada**: quien tiene que
     * conseguir otro token es quien prestó éste.
     */
    public function test_un_401_no_intenta_refrescar_lo_que_no_es_suyo(): void
    {
        $transport = new FakeTransport(
            static fn () => FakeTransport::json(['message' => 'Unauthenticated.'], 401),
        );

        $client = PimiaClient::withBorrowedToken(self::BASE, 'un-token-caducado', $transport);

        try {
            $client->get('/customers');
            $this->fail('Un 401 con token prestado tiene que subir.');
        } catch (UnauthorizedException $e) {
            $this->assertSame(401, $e->status);
        }

        $this->assertCount(1, $transport->calls, 'Ha habido una segunda llamada: alguien ha intentado refrescar.');
        $this->assertSame([], $transport->callsTo('/oauth/token'));
    }

    /**
     * Un token vacío se corta ANTES de llamar.
     *
     * Si no, el 401 llegaría desde Pimia y se confundiría con un token
     * caducado — cuando lo que pasa es que la cabecera `Authorization` de la
     * petición que atiendes venía vacía.
     */
    public function test_un_token_vacio_no_llega_a_llamar(): void
    {
        $transport = new FakeTransport(static fn () => FakeTransport::json([]));

        $this->expectException(NotAuthenticatedException::class);

        try {
            PimiaClient::withBorrowedToken(self::BASE, '   ', $transport);
        } finally {
            $this->assertSame([], $transport->calls);
        }
    }

    /**
     * Sin reintentos, un 429 sube en vez de dormir.
     *
     * Es la opción por defecto que recomienda el modo para un servicio que
     * atiende peticiones web: los reintentos del SDK duermen, y dormir dentro
     * de la petición de un usuario es una petición colgada y un proceso
     * ocupado.
     */
    public function test_con_los_reintentos_a_cero_el_429_sube_sin_dormir(): void
    {
        $dormidas = [];
        $transport = new FakeTransport(static fn () => FakeTransport::json(['message' => 'slow down'], 429));

        $client = PimiaClient::withBorrowedToken(
            self::BASE,
            'at',
            $transport,
            maxRateLimitRetries: 0,
            sleeper: static function (int $segundos) use (&$dormidas) {
                $dormidas[] = $segundos;
            },
        );

        try {
            $client->get('/customers');
            $this->fail('El 429 tenía que subir.');
        } catch (PimiaException $e) {
            $this->assertSame(429, $e->getCode());
        }

        $this->assertCount(1, $transport->calls);
        $this->assertSame([], $dormidas);
    }

    /**
     * El store de un token prestado se niega a guardar.
     *
     * Hoy nadie le llama —el cliente sólo persiste tras un refresco, y aquí no
     * hay refrescos—, y el guardia existe para que el día que ese camino
     * cambie el error diga qué pasa aquí y no en el grant de otro.
     */
    public function test_el_store_prestado_se_niega_a_guardar_y_no_tiene_nada_que_borrar(): void
    {
        $store = new BorrowedTokenStore('at-prestado');

        $this->assertSame('at-prestado', $store->load()?->accessToken);
        $this->assertNull($store->load()?->refreshToken, 'Un token prestado no trae refresh: el refresh es del dueño.');

        $store->clear();
        $this->assertSame('at-prestado', $store->load()?->accessToken, 'Borrar un token prestado no borra nada.');

        $this->expectException(PimiaException::class);
        $store->save(new TokenSet('otro'));
    }
}
