<?php

declare(strict_types=1);

namespace Pimia\Exception;

/**
 * 401: el access token no vale (caducado, revocado, o el usuario retiró el
 * acceso desde Ajustes → Apps conectadas). El cliente intenta refrescar una
 * vez por su cuenta; si vuelve a salir, hay que re-autorizar al usuario.
 */
class UnauthorizedException extends ApiException
{
}
