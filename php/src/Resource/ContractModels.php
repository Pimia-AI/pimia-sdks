<?php

declare(strict_types=1);

namespace Pimia\Resource;

use Pimia\PimiaClient;

/**
 * El catálogo de clausulados de la empresa (núcleo #934).
 *
 * El clausulado es un FORMATO DE DATOS, no HTML ni una plantilla: un árbol
 * plano de bloques (`heading`, `paragraph`, `list`, `table`, `signature`) y,
 * dentro, trozos de texto o marcadores (`text`, `variable`). Lo valida el
 * servidor, entero, y un marcador que no exista en el diccionario es un 422
 * con su nombre — nunca un hueco borrado en silencio.
 *
 * ⛔ Sus permisos son PROPIOS: poder editar o enviar un contrato no concede
 * redactar ni publicar modelos (`view-contract-model`, `create-contract-model`,
 * `edit-contract-model`, `publish-contract-model`, `archive-contract-model`).
 * El scope sigue siendo `contracts:read` / `contracts:write`.
 *
 * Se llega desde {@see Contracts::$models}: `$client->contracts->models`.
 */
final class ContractModels
{
    public function __construct(private readonly PimiaClient $client)
    {
    }

    /**
     * Los modelos de la empresa activa.
     *
     * Por defecto solo los `ACTIVE`, porque el listado sirve sobre todo para
     * ELEGIR y un archivado no se puede elegir; `['status' => 'ALL']` devuelve
     * también los archivados y `['limit' => 'all']`, la lista entera sin
     * paginar. Con `limit` numérico la respuesta trae la paginación de Laravel.
     *
     * @param  array<string, mixed>  $query
     */
    public function list(array $query = []): mixed
    {
        return $this->client->get('/contract-models', $query);
    }

    /** Un modelo con su borrador, su versión publicada y su historial. */
    public function get(int|string $id): mixed
    {
        return $this->client->get("/contract-models/{$id}");
    }

    /**
     * Crea un modelo, con su borrador si mandas `content`.
     *
     * `status` no se acepta: archivar es su propia acción. El alta con
     * borrador ya es la revisión 1.
     *
     * @param  array{name: string, content?: array<int, array<string, mixed>>|null, draft_revision?: int|null}  $data
     */
    public function create(array $data, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post('/contract-models', $data, $idempotencyKey);
    }

    /**
     * Edita el nombre y el borrador.
     *
     * ⛔ Mandar `content` exige la `draft_revision` que LEÍSTE: si otra edición
     * guardó mientras tanto, el núcleo responde **409** con el porqué y no pisa
     * su texto. Vuelve a leer el modelo y reaplica tus cambios; no reintentes
     * con el mismo número. Omitir `content` conserva el borrador; mandarlo
     * —aunque sea con un solo párrafo— lo sustituye entero.
     *
     * @param  array{name: string, content?: array<int, array<string, mixed>>|null, draft_revision?: int|null}  $data
     */
    public function update(int|string $id, array $data): mixed
    {
        return $this->client->put("/contract-models/{$id}", $data);
    }

    /**
     * Publica el borrador como versión INMUTABLE.
     *
     * Aquí sí se exige el bloque de firma —uno, ni cero ni dos—, y los modos
     * compatibles se DEDUCEN de los marcadores usados: no se declaran.
     *
     * ⛔ Publicar la v2 no toca la v1 ni los contratos que la eligieron. Nunca
     * elijas «la última» en silencio: la versión es una decisión.
     */
    public function publish(int|string $id, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post("/contract-models/{$id}/publish", [], $idempotencyKey);
    }

    /**
     * Retira el modelo de las selecciones NUEVAS.
     *
     * No borra ni versiones ni contratos: los que ya apuntan a una de sus
     * versiones siguen imprimiendo y firmando ese texto.
     */
    public function archive(int|string $id, ?string $idempotencyKey = null): mixed
    {
        return $this->client->post("/contract-models/{$id}/archive", [], $idempotencyKey);
    }

    /**
     * El diccionario de marcadores: etiqueta, tipo, formato, requisito,
     * permiso y ejemplo de cada uno.
     *
     * Con `$billingMode` devuelve solo lo que ESE modo tiene de verdad, que es
     * lo que impide ofrecer «cuota mensual» al redactar el modelo de un
     * contrato por hitos y descubrir el error cinco pantallas después.
     *
     * `meta` trae `block_types`, `inline_types` y los `limits` vivos del
     * esquema: léelos de ahí en vez de clavarlos en tu integración.
     *
     * @param  string|null  $billingMode  `INSTALLMENTS`, `MILESTONES`, `ONE_OFF` o `NONE`
     */
    public function variables(?string $billingMode = null): mixed
    {
        return $this->client->get(
            '/contract-models/variables',
            $billingMode === null ? [] : ['billing_mode' => $billingMode],
        );
    }
}
