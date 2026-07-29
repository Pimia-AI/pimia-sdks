<?php

declare(strict_types=1);

namespace Pimia\Exception;

/** 422: validación de negocio (FormRequests de Pimia). */
class ValidationException extends ApiException
{
    /**
     * Errores por campo, como los devuelve Laravel.
     *
     * @return array<string, list<string>>
     */
    public function errors(): array
    {
        return is_array($this->body) && isset($this->body['errors']) && is_array($this->body['errors'])
            ? $this->body['errors']
            : [];
    }
}
