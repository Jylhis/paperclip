{ pkgs, ... }:

let
  toolchain = import ./nix/dev-toolchain.nix {
    inherit (pkgs)
      nodejs_22
      pnpm_9
      python3
      vips
      pkg-config
      git
      gh
      ripgrep
      openssh
      jq
      curl
      wget
      gnutar
      zstd
      ;
  };
in

{
  # Node + pnpm toolchain. Matches Dockerfile (node:lts-trixie-slim →
  # Node 22 LTS), CI (pr.yml, release.yml use node-version: 24 — Node 22
  # is the LTS compromise) and package.json engines `>=20`.
  languages.javascript = {
    enable = true;
    package = toolchain.nodejs;
    pnpm.enable = true;
    pnpm.package = toolchain.pnpm;
    # Do NOT auto-install with devenv. Dependency materialisation is explicit:
    # `nix run .#install-deps`, which uses the flake's fixed-output
    # `fetchPnpmDeps` store before invoking pnpm offline.
    pnpm.install.enable = false;
  };

  # V8's default ~1.7 GB old-space cap trips
  # `Ineffective mark-compacts near heap limit` during `pnpm build` and
  # the heavier vitest runs. 4 GiB clears every observed workspace build.
  env.NODE_OPTIONS = toolchain.nodeOptions;

  # Optional dev Postgres matching .env.example. DATABASE_URL is NOT
  # exported here, so `pnpm dev` keeps using embedded PostgreSQL by default
  # (AGENTS.md §4). Run `devenv up` and export DATABASE_URL only when
  # you want to test against real Postgres.
  services.postgres = {
    enable = true;
    package = pkgs.postgresql_16;
    listen_addresses = "127.0.0.1";
    port = 5432;
    initialDatabases = [
      {
        name = "paperclip";
        user = "paperclip";
        pass = "paperclip";
      }
    ];
  };

  packages = toolchain.packages;

  enterShell = ''
    # devenv puts the same Nix-provided Node/pnpm toolchain on PATH as
    # `nix develop`. Use `nix run .#install-deps` to materialise
    # node_modules from the flake's prefetched PNPM store.
    export PATH="${toolchain.nodejs}/bin:${toolchain.pnpm}/bin:$PATH"

    echo "paperclip dev shell — Node $(node --version), pnpm $(pnpm --version)"
    echo ""
    echo "Database:"
    echo "  Default (embedded): leave DATABASE_URL unset, run 'pnpm dev'"
    echo "  Real Postgres:      'devenv up' then"
    echo "                      'export DATABASE_URL=postgres://paperclip:paperclip@localhost:5432/paperclip'"
  '';
}
