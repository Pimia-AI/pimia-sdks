<?php

declare(strict_types=1);

namespace Pimia\Http;

/** Cuerpo y metadatos de una misma respuesta. */
final class ResponseWithMeta
{
    public function __construct(
        public readonly mixed $data,
        public readonly ResponseMeta $meta,
    ) {
    }
}
