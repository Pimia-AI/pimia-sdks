<?php

declare(strict_types=1);

namespace Pimia\Http;

/** Respuesta ya decodificada: lo que el SDK necesita, sin arrastrar PSR-7. */
final class Response
{
    /**
     * @param  array<string, mixed>|string|null  $body
     * @param  array<string, string>  $headers  Claves en minúsculas.
     * @param  string|null  $raw  Los bytes TAL CUAL llegaron, sin decodificar.
     *                            `null` si el transporte no los conserva (uno
     *                            propio anterior a este campo): la descarga
     *                            ({@see \Pimia\PimiaClient::download()}) lo
     *                            dice en vez de inventarlos.
     */
    public function __construct(
        public readonly int $status,
        public readonly array|string|null $body,
        public readonly array $headers = [],
        public readonly ?string $raw = null,
    ) {
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function isSuccessful(): bool
    {
        return $this->status < 400;
    }
}
