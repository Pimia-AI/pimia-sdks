#!/usr/bin/env bash
#
# Refresca el OpenAPI desde el core y regenera los tipos de TypeScript.
#
#   ./scripts/sync-spec.sh /ruta/al/checkout/de/factSaas
#   ./scripts/sync-spec.sh --ref origin/release/x /ruta/al/checkout
#   ./scripts/sync-spec.sh --force /ruta/al/checkout      # acepta un spec menor
#
# El spec lo genera el core con `php artisan scramble:export` (Scramble vive en
# require-dev), así que aquí solo se COPIA el artefacto ya generado: este repo
# no necesita PHP ni el core para nada más.
#
# ⚠️ Lee el artefacto de `git show <ref>:docs/openapi/…`, NO del working tree
# del checkout. Con varios worktrees de factSaas a la vez, ese working tree
# suele estar en otra rama y muy por detrás: así se sincronizó la 0.5.0 con un
# spec 82 operaciones viejo sin que nada avisara. Y hace `git fetch` antes, para
# que `origin/main` sea el de verdad y no el de la última vez que se miró.
set -euo pipefail

REF="origin/main"
FORCE=0
CORE=""
SOURCE_REL="docs/openapi/pimia-api-v1.json"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/spec/pimia-api-v1.json"

uso() {
  cat >&2 <<'USO'
uso: sync-spec.sh [--ref <git-ref>] [--force] /ruta/al/checkout/de/factSaas

  --ref <git-ref>  ref del core de donde leer el spec (por defecto origin/main)
  --force          sigue adelante aunque el spec nuevo tenga MENOS operaciones
USO
  exit 64
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) [[ $# -ge 2 ]] || uso; REF="$2"; shift 2 ;;
    --ref=*) REF="${1#--ref=}"; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) uso ;;
    -*) echo "opción desconocida: $1" >&2; uso ;;
    *) [[ -z "$CORE" ]] || { echo "sobra el argumento: $1" >&2; uso; }; CORE="$1"; shift ;;
  esac
done

[[ -n "$CORE" ]] || uso

if ! git -C "$CORE" rev-parse --git-dir >/dev/null 2>&1; then
  echo "no es un repositorio git: $CORE" >&2
  exit 66
fi

# Cuenta operaciones (método HTTP × ruta) de un OpenAPI por stdin.
contar_ops() {
  node -e '
    let raw = ""
    process.stdin.on("data", (c) => (raw += c))
    process.stdin.on("end", () => {
      const METODOS = new Set(["get","put","post","delete","patch","head","options","trace"])
      let spec
      try {
        spec = JSON.parse(raw)
      } catch (e) {
        console.error("el spec no es JSON válido: " + e.message)
        process.exit(65)
      }
      const paths = spec.paths ?? {}
      let ops = 0
      for (const item of Object.values(paths)) {
        for (const clave of Object.keys(item ?? {})) {
          if (METODOS.has(clave.toLowerCase())) ops++
        }
      }
      process.stdout.write(String(ops))
    })
  '
}

command -v node >/dev/null 2>&1 || { echo "hace falta node para validar y regenerar" >&2; exit 69; }

echo "› git fetch en ${CORE}…"
git -C "$CORE" fetch --quiet origin

if ! git -C "$CORE" cat-file -e "$REF:$SOURCE_REL" 2>/dev/null; then
  echo "no encuentro $SOURCE_REL en $REF (dentro de $CORE)" >&2
  echo "genéralo en el core con: php artisan scramble:export, y súbelo a $REF" >&2
  exit 66
fi

COMMIT="$(git -C "$CORE" rev-parse "$REF")"
COMMIT_CORTO="$(git -C "$CORE" rev-parse --short "$REF")"
FECHA="$(git -C "$CORE" log -1 --format=%cs "$REF")"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
git -C "$CORE" show "$REF:$SOURCE_REL" > "$TMP"

OPS_NUEVAS="$(contar_ops < "$TMP")"
if [[ -f "$DEST" ]]; then
  OPS_ACTUALES="$(contar_ops < "$DEST")"
else
  OPS_ACTUALES=0
fi

echo "› spec en $REF ($COMMIT_CORTO, $FECHA): $OPS_NUEVAS operaciones"
echo "› spec en este repo:                    $OPS_ACTUALES operaciones"

if (( OPS_NUEVAS < OPS_ACTUALES )); then
  if (( FORCE )); then
    echo "⚠️  el spec nuevo tiene $((OPS_ACTUALES - OPS_NUEVAS)) operaciones MENOS; sigo por --force" >&2
  else
    cat >&2 <<EOF
✗ ABORTADO: el spec de $REF tiene $((OPS_ACTUALES - OPS_NUEVAS)) operaciones MENOS
  que el que ya está en este repo ($OPS_NUEVAS < $OPS_ACTUALES).

  Un contrato público no encoge por accidente. Comprueba que $REF es la rama
  que crees y que el export del core se hizo con la base de datos alcanzable
  (sin ella Scramble degrada el artefacto). Si la reducción es intencionada
  —operaciones retiradas del contrato a propósito—, repite con --force y
  explícalo en el CHANGELOG.
EOF
    exit 1
  fi
fi

cp "$TMP" "$DEST"
echo "✓ spec actualizado desde $CORE ($REF @ $COMMIT_CORTO)"
echo
echo "  Anota en el CHANGELOG el commit del núcleo:"
echo "    factSaas@$COMMIT_CORTO ($FECHA) — $OPS_NUEVAS operaciones"
echo "    $COMMIT"
echo

if command -v npm >/dev/null 2>&1; then
  (cd "$ROOT/typescript" && npm run --silent generate:types)
  echo "✓ tipos de TypeScript regenerados (src/api.ts; api.d.ts sale del build)"
else
  echo "npm no disponible: regenera los tipos con 'cd typescript && npm run generate:types'" >&2
fi

git -C "$ROOT" --no-pager diff --stat -- spec typescript/src/api.ts || true
