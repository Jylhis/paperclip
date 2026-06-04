#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

deps_store="$(nix build --no-link --print-out-paths "$repo_root#paperclip-pnpm-deps")"
local_store="$repo_root/.pnpm-store/nix"
store_marker="$local_store/.paperclip-source"
store_marker_value="$deps_store writable-v1"

if [[ ! -f "$store_marker" ]] || [[ "$(cat "$store_marker")" != "$store_marker_value" ]]; then
  [[ -d "$local_store.tmp" ]] && chmod -R u+w "$local_store.tmp"
  rm -rf "$local_store.tmp"
  mkdir -p "$local_store.tmp"
  tar --zstd -xf "$deps_store/pnpm-store.tar.zst" -C "$local_store.tmp"
  chmod -R u+w "$local_store.tmp"
  printf '%s\n' "$store_marker_value" > "$local_store.tmp/.paperclip-source"
  [[ -d "$local_store" ]] && chmod -R u+w "$local_store"
  rm -rf "$local_store"
  mv "$local_store.tmp" "$local_store"
fi

exec nix develop "$repo_root" --command bash -lc '
  set -euo pipefail
  local_store="$1"
  shift
  if [[ -n "${PAPERCLIP_NIX_PATH_PREFIX:-}" ]]; then
    export PATH="${PAPERCLIP_NIX_PATH_PREFIX}:$PATH"
  fi
  export COREPACK_ENABLE_STRICT=0
  exec pnpm install --offline --frozen-lockfile --store-dir "$local_store" "$@"
' bash "$local_store" "$@"
