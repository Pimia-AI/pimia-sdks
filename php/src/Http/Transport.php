<?php

declare(strict_types=1);

namespace Pimia\Http;

/**
 * Puerta de salida HTTP. Se aísla en una interfaz por dos razones: el SDK no
 * impone cliente HTTP (cualquier PSR-18 vale, ver PsrTransport) y los tests
 * pueden sustituirla sin red.
 */
interface Transport
{
    /**
     * @param  array<string, string>  $headers
     */
    public function send(string $method, string $url, array $headers = [], ?string $body = null): Response;
}
