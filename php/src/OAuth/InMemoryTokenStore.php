<?php

declare(strict_types=1);

namespace Pimia\OAuth;

/**
 * Store de memoria: vale para scripts de un tiro y para tests. NO para
 * producción — al morir el proceso se pierde el refresh rotado y el usuario
 * tiene que volver a autorizar.
 */
final class InMemoryTokenStore implements TokenStore
{
    public function __construct(private ?TokenSet $tokens = null)
    {
    }

    public function load(): ?TokenSet
    {
        return $this->tokens;
    }

    public function save(TokenSet $tokens): void
    {
        $this->tokens = $tokens;
    }

    public function clear(): void
    {
        $this->tokens = null;
    }
}
