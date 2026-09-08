<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/**
 * El arranque de la sesión: en qué empresa trabaja este token y con qué moneda.
 *
 * ── ⛔ Lo primero, porque es lo que rompe integraciones: `/bootstrap` NO
 *    envuelve en `data` ─────────────────────────────────────────────────────
 *
 * Todo lo demás en el API de Pimia contesta `{"data": …}`. Ésta no: sus claves
 * —`current_user`, `current_company`, `current_company_currency`…— cuelgan de
 * la raíz. Un desenvolvedor de `data` escrito «para todas las llamadas» no
 * encuentra nada aquí y devuelve un array vacío **sin error**, así que el fallo
 * no se ve como un fallo: se ve como una empresa sin resolver o como una moneda
 * que cae al respaldo. Medido construyendo el CRM de la vertical, que tuvo que
 * anotarlo en su propio código y en el arnés de sus tests.
 *
 * Por eso {@see self::get()} devuelve el cuerpo TAL CUAL y los dos ayudantes de
 * abajo existen: para que nadie tenga que volver a descubrirlo.
 *
 * ── Qué hace falta para llamarla ────────────────────────────────────────────
 *
 * Nada más que un token válido. Es «catálogo `meta`» en el contrato: lectura
 * libre, **sin scope** y sin consentimiento adicional del dueño del tenant. Eso
 * la convierte en la única forma barata de que un integrador sepa en qué
 * empresa está sin pedir permisos que no necesita.
 *
 * ⚠️ Cada método hace SU llamada: no hay caché. Es a propósito —el cliente no
 * sabe cuánto vive una sesión tuya y una empresa cacheada de más es una fila
 * escrita en la empresa equivocada—, así que si necesitas las dos cosas en la
 * misma petición, llama a {@see self::get()} una vez y léelas del array.
 */
final class Bootstrap
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /**
     * El arranque entero, sin envolver.
     *
     * @return mixed `array<string, mixed>` con `current_company`,
     *               `current_company_currency`, `current_user`… en la RAÍZ.
     */
    public function get(): mixed
    {
        return $this->client->get('/bootstrap');
    }

    /**
     * En qué empresa trabaja ESTA petición, según el núcleo.
     *
     * ⛔ No es «la primera empresa del usuario», aunque hoy coincidan. Pimia
     * resuelve `current_company` con el mismo camino y el mismo respaldo que
     * usa su middleware de empresa para servir cualquier otra llamada tuya —la
     * cabecera `company` si vale, y si no la primera del usuario—, así que
     * preguntarlo aquí es la única forma de que tu lado y el suyo no puedan
     * discrepar. Deducirlo de la lista de `/me` reproduce la regla en un
     * segundo sitio, y dos reglas iguales son dos reglas que pueden separarse:
     * el día que dejaran de coincidir, escribirías con una empresa que Pimia
     * nunca usó y sin un solo error que lo denuncie.
     *
     * `null` si el arranque no la publica. Trátalo como «no se puede servir
     * esta sesión» y no como un cero: un cero es una empresa que no es de nadie
     * y que ve cualquiera que también acabe ahí.
     */
    public function currentCompanyId(): ?int
    {
        $company = $this->field('current_company');

        if (! is_array($company) || ! isset($company['id']) || ! is_numeric($company['id'])) {
            return null;
        }

        return (int) $company['id'];
    }

    /**
     * La moneda de la empresa y su ESCALA.
     *
     * ⛔ La moneda no es siempre el euro y los decimales cambian con ella: el
     * yen tiene 0, el dinar kuwaití 3. Suponer 2 —o peor, multiplicar por 100 a
     * mano— no da un error, da otro resultado: un filtro por importe devuelve
     * otras filas y un alta guarda una moneda falsa en la ficha. Por eso la
     * escala se PREGUNTA.
     *
     * `null` si el arranque no publica moneda —el campo admite nulo en el
     * contrato— y ahí el SDK NO se inventa nada: «EUR con 2 decimales» es una
     * política de producto, la decide quien llama.
     *
     * Lo que sí se lee a la defensiva es `precision`: el contrato lo declara
     * obligatorio dentro de la moneda, así que un cuerpo sin él está roto y no
     * es un caso de negocio; se cae a 2 para no partir la lectura por un campo
     * que no debería faltar.
     *
     * @return array{code: string, precision: int}|null
     */
    public function currency(): ?array
    {
        $currency = $this->field('current_company_currency');

        if (! is_array($currency) || ! isset($currency['code']) || ! is_string($currency['code'])) {
            return null;
        }

        return [
            'code' => $currency['code'],
            'precision' => is_numeric($currency['precision'] ?? null) ? (int) $currency['precision'] : 2,
        ];
    }

    private function field(string $key): mixed
    {
        $body = $this->get();

        return is_array($body) ? ($body[$key] ?? null) : null;
    }
}
