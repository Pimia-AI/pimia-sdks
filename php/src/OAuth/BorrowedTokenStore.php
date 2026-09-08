<?php

declare(strict_types=1);

namespace Pimia\OAuth;

use Pimia\Exception\PimiaException;

/**
 * El «store» de un token que NO es tuyo.
 *
 * ── Para qué existe ─────────────────────────────────────────────────────────
 *
 * Hay integraciones que no poseen ningún grant y **no deben poseerlo**: un
 * servicio al que el front le manda, en cada petición, el `Authorization` del
 * usuario que ha entrado en Pimia, y que lo reenvía tal cual. La consecuencia
 * buena es que Pimia sigue decidiendo los permisos: ese servicio no puede darle
 * a nadie más de lo que su token ya le daba, y no hay una credencial propia que
 * auditar aparte.
 *
 * Un token prestado **no trae refresh** —el refresh es del dueño del grant— y
 * dura lo que dure la petición. Eso hace que todo lo que este SDK protege del
 * `TokenStore` de verdad {@see TokenStore} no aplique aquí: no hay rotación que
 * persistir, ni reuse que evitar, ni lock por usuario que sostener.
 *
 * ── Por qué `save()` REVIENTA en vez de callar ──────────────────────────────
 *
 * Porque llegar ahí significaría que el cliente ha creído refrescar un token
 * ajeno. Hoy no puede pasar por construcción —sin `refreshToken` el 401 sube
 * tal cual en vez de disparar un refresco—, y justo por eso el día que alguien
 * cambie ese camino conviene que se entere aquí, con el nombre de la clase
 * dentro, y no en producción como un grant de otro revocado en cascada.
 *
 * No se construye a mano: sale de {@see \Pimia\PimiaClient::withBorrowedToken()}.
 */
final class BorrowedTokenStore implements TokenStore
{
    public function __construct(private readonly string $accessToken)
    {
    }

    public function load(): ?TokenSet
    {
        // Sin `refreshToken` y sin `expiresAt`: los dos son del dueño del
        // grant. Sin expiración el cliente no intenta refrescar por su cuenta,
        // y sin refresh un 401 sube tal cual — que es lo correcto: quien tiene
        // que conseguir otro token es quien te prestó éste.
        return new TokenSet($this->accessToken);
    }

    public function save(TokenSet $tokens): void
    {
        throw new PimiaException(
            'Este cliente usa un token prestado: no hay grant propio que rotar ni nada que persistir. '
            .'Si has llegado aquí, alguien ha intentado refrescar el token de otro.',
        );
    }

    /**
     * No-op, y no es pereza: no hay nada que borrar. El token vive en la
     * petición que lo trajo y muere con ella.
     */
    public function clear(): void
    {
    }
}
