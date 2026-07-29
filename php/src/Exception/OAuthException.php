<?php

declare(strict_types=1);

namespace Pimia\Exception;

/** Error del flujo OAuth (token endpoint, revocación, metadata). */
class OAuthException extends PimiaException
{
    public function __construct(
        public readonly string $error,
        public readonly ?string $description = null,
    ) {
        parent::__construct($description === null ? $error : "{$error}: {$description}");
    }
}
