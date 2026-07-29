<?php

declare(strict_types=1);

namespace Pimia\Exception;

/** Raíz de todos los errores del SDK: un solo catch si no quieres distinguir. */
class PimiaException extends \RuntimeException
{
}
