<?php

declare(strict_types=1);

namespace Pimia\Exception;

/** 403 que no es por scope (Bouncer, política de negocio…). */
class ForbiddenException extends ApiException
{
}
