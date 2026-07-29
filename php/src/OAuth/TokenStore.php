<?php

declare(strict_types=1);

namespace Pimia\OAuth;

/**
 * Persistencia de los tokens de un usuario.
 *
 * ⚠️ LO MÁS IMPORTANTE DE ESTE SDK. El refresh token de Pimia **rota**: cada
 * canje devuelve uno nuevo y mata el anterior, y **reusar uno ya rotado se
 * trata como robo: revoca el grant entero en cascada** (todos los tokens de tu
 * app para ese usuario mueren y el usuario tiene que volver a autorizarte).
 *
 * Por eso el cliente exige un store y guarda el TokenSet ENTERO tras cada
 * refresco. Implementa esta interfaz sobre tu BD (una fila por usuario de
 * Pimia). Si tu app corre en varios procesos, el store debe ser compartido y
 * conviene serializar el refresco (un lock por usuario): dos refrescos
 * concurrentes con el mismo token son, para el servidor, un reuse.
 */
interface TokenStore
{
    public function load(): ?TokenSet;

    public function save(TokenSet $tokens): void;

    public function clear(): void;
}
