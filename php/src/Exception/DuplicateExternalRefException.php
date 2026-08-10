<?php

declare(strict_types=1);

namespace Pimia\Exception;

/**
 * 422 `external_ref_already_used`: la referencia externa que intentaste colgar
 * ya la lleva otro recurso del mismo tipo dentro de tu namespace (company +
 * client OAuth).
 *
 * **Lo normal es que no sea un error tuyo, sino tu reintento**: «crea el cliente
 * del deal 42» ejecutado dos veces porque el proceso se cayó entre el POST y el
 * guardado de tu mapeo. Por eso el error trae `$existingId`, el recurso que ya
 * lleva esa referencia — que es lo que convierte el choque en un find-or-create
 * sin mantener ningún mapeo local:
 *
 * ```php
 * try {
 *     $cliente = $pimia->customers()->create([
 *         'name' => $nombre,
 *         'external_ref' => "deal_{$dealId}",
 *     ]);
 *
 *     return (int) $cliente['id'];
 * } catch (DuplicateExternalRefException $e) {
 *     return $e->existingId; // ya existía: el propio error dice cuál es
 * }
 * ```
 *
 * Extiende {@see ValidationException} a propósito: el cuerpo trae también el
 * `errors` de siempre, así que el código que ya capturaba los 422 por ese camino
 * sigue funcionando sin ramas nuevas.
 */
class DuplicateExternalRefException extends ValidationException
{
    /**
     * @param  int  $existingId  Id del recurso que YA lleva esa referencia.
     * @param  string  $externalRef  La referencia que chocó, tal y como la mandaste.
     * @param  string  $entityType  Tipo del recurso en el core (`customer`, `estimate`, `invoice`).
     * @param  array<string, mixed>|string|null  $body
     */
    public function __construct(
        public readonly int $existingId,
        public readonly string $externalRef,
        public readonly string $entityType,
        int $status,
        string $message,
        array|string|null $body = null,
        ?string $requestId = null,
    ) {
        parent::__construct($status, $message, $body, $requestId);
    }
}
