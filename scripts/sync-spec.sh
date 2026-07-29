#!/usr/bin/env bash
#
# Refresca el OpenAPI desde un checkout del core y regenera los tipos de TS.
#
#   ./scripts/sync-spec.sh /ruta/al/checkout/de/factSaas
#
# El spec lo genera el core con `php artisan scramble:export` (Scramble vive en
# require-dev), así que aquí solo se COPIA el artefacto ya generado: este repo
# no necesita PHP ni el core para nada más.
set -euo pipefail

CORE="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_REL="docs/openapi/pimia-api-v1.json"

if [[ -z "$CORE" ]]; then
  echo "uso: $0 /ruta/al/checkout/de/factSaas" >&2
  exit 64
fi

if [[ ! -f "$CORE/$SOURCE_REL" ]]; then
  echo "no encuentro $CORE/$SOURCE_REL" >&2
  echo "genéralo en el core con: php artisan scramble:export" >&2
  exit 66
fi

cp "$CORE/$SOURCE_REL" "$ROOT/spec/pimia-api-v1.json"
echo "spec actualizado desde $CORE"

if command -v npm >/dev/null 2>&1; then
  (cd "$ROOT/typescript" && npm run --silent generate:types)
  echo "tipos de TypeScript regenerados"
else
  echo "npm no disponible: regenera los tipos con 'cd typescript && npm run generate:types'" >&2
fi

git -C "$ROOT" --no-pager diff --stat -- spec typescript/src/api.ts || true
