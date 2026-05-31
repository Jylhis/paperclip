# Paperclip recipes. Run `just` (no args) for the list.
#
# Heavy NixOS VM tests live here (not in `flake.checks`) so
# `nix flake check` stays fast. Each `test-vm-*` recipe boots a
# full VM and takes minutes — invoke only when you need them.

system := `nix eval --raw --impure --expr 'builtins.currentSystem'`

# Default: list available recipes.
default:
    @just --list

# ---- Dev shell / deps ----------------------------------------------------

# Materialise node_modules from the Nix-prefetched pnpm store.
install:
    nix run .#install-deps

# Remove build artefacts and dependency caches.
clean:
    rm -rf node_modules ui/dist ui/node_modules/.vite server/dist packages/*/dist result result-* .devenv

# ---- Dev runner ----------------------------------------------------------

# Start the API + UI dev runner in watch mode.
dev:
    pnpm dev

# Start the dev runner without file watching.
dev-once:
    pnpm dev:once

# Start the UI dev server only.
dev-ui:
    pnpm dev:ui

# List managed dev runners for this repo + instance.
dev-list:
    pnpm dev:list

# Stop the managed dev runner for this repo + instance.
dev-stop:
    pnpm dev:stop

# ---- Quality gates -------------------------------------------------------
# Mirrors AGENTS.md §7 "Verification Before Hand-off".

# Typecheck every workspace.
typecheck:
    pnpm -r typecheck

# Run the default Vitest suite (cheap default).
test:
    pnpm test:run

# Run Vitest in watch mode.
test-watch:
    pnpm test:watch

# Run Vitest with coverage instrumentation.
test-coverage:
    pnpm test:coverage

# Build every workspace.
build:
    pnpm build

# Full pre-PR hand-off check: typecheck + test + build.
verify: typecheck test build

# ---- Database ------------------------------------------------------------
# Mirrors AGENTS.md §6 "Database Change Workflow".

# Generate Drizzle migrations from packages/db schema.
db-generate:
    pnpm db:generate

# Apply pending migrations against the configured DATABASE_URL.
db-migrate:
    pnpm db:migrate

# ---- Nix -----------------------------------------------------------------

# Run the cheap pure-eval flake checks.
nix-check:
    nix flake check -L

# Format Nix sources via the flake's formatter (nixfmt).
nix-fmt:
    nix fmt

# Build the Linux production paperclip package.
nix-build:
    nix build -L .#paperclip

# Build the standalone UI bundle.
nix-build-ui:
    nix build -L .#paperclip-ui

# Build the MCP server bundle.
nix-build-mcp:
    nix build -L .#paperclip-mcp-server

# Build the paperclipai CLI bundle.
nix-build-paperclipai:
    nix build -L .#paperclipai

# ---- NixOS VM tests ------------------------------------------------------

# Run every NixOS VM test in sequence.
test-vm: test-vm-default test-vm-postgres test-vm-tailnet test-vm-external

# Lightweight module sanity test: createLocally + nginx proxy.
test-vm-default:
    nix build -L .#vmTests.{{system}}.module-default

# NixOS-managed PostgreSQL + password-applier oneshot.
test-vm-postgres:
    nix build -L .#vmTests.{{system}}.module-postgres

# `listen.mode = "tailnet"` with a shimmed tailscale binary.
test-vm-tailnet:
    nix build -L .#vmTests.{{system}}.module-tailnet

# External DB mode: sidecar Postgres + DATABASE_MIGRATION_URL plumbing.
test-vm-external:
    nix build -L .#vmTests.{{system}}.module-external

# ---- Updates -------------------------------------------------------------
# Order: flake → devenv (auto-follows flake's nixpkgs) → pnpm-lock → pnpmDepsHash.
# `just update` chains all four; each sub-recipe is also invocable alone.
#
# Note: per doc/DEVELOPING.md, CI owns pnpm-lock.yaml — do NOT commit a
# locally-refreshed pnpm-lock.yaml in a PR. `just update-pnpm` exists for
# local dep bumps and for recomputing pnpmDepsHash; refresh-lockfile.yml
# is the authoritative source on master.

# Refresh every dependency pin in dependency order.
update: update-flake update-devenv update-pnpm update-pnpm-hash

# Bump flake.lock (nixos-unstable). Authoritative nixpkgs pin.
update-flake:
    nix flake update

# Bump devenv.lock. Picks up the flake's new nixpkgs rev via devenv.yaml.
update-devenv:
    devenv update

# Refresh pnpm-lock.yaml only (no node_modules write). Mirrors CI refresh-lockfile.yml.
update-pnpm:
    pnpm install --lockfile-only --no-frozen-lockfile

# Verify pnpmDepsHash in nix/lib.nix matches pnpm-lock.yaml; prints the new hash if not.
update-pnpm-hash:
    #!/usr/bin/env bash
    set -euo pipefail
    if out=$(nix build -L .#paperclip-pnpm-deps 2>&1); then
        echo "pnpmDepsHash already in sync with pnpm-lock.yaml"
        exit 0
    fi
    printf '%s\n' "$out" >&2
    got=$(printf '%s\n' "$out" | grep -E 'got:[[:space:]]+sha256-' | head -1 | sed -E 's/.*got:[[:space:]]+(sha256-[^[:space:]]+).*/\1/')
    if [ -n "$got" ]; then
        echo ""
        echo "Paste this into nix/lib.nix (replace the existing pnpmDepsHash):"
        echo "    pnpmDepsHash = \"$got\";"
    else
        echo ""
        echo "Could not extract the expected hash from the build output above."
        echo "Re-pin manually per the comment block in nix/lib.nix."
    fi
    exit 1
