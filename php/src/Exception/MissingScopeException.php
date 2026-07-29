<?php

declare(strict_types=1);

namespace Pimia\Exception;

/**
 * 403 del api-guard: al token le falta un scope. `$scope` viene parseado del
 * mensaje para que sepas exactamente qué pedir en el próximo authorize.
 */
class MissingScopeException extends ForbiddenException
{
    /**
     * @param  array<string, mixed>|string|null  $body
     */
    public function __construct(
        public readonly string $scope,
        int $status,
        string $message,
        array|string|null $body = null,
        ?string $requestId = null,
    ) {
        parent::__construct($status, $message, $body, $requestId);
    }
}
