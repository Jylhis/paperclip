# Paperclip recipes. Run `just` (no args) for the list.
#
# Heavy NixOS VM tests live here (not in `flake.checks`) so
# `nix flake check` stays fast. Each `test-vm-*` recipe boots a
# full VM and takes minutes — invoke only when you need them.

system := `nix eval --raw --impure --expr 'builtins.currentSystem'`

# Default: list available recipes.
default:
    @just --list

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
