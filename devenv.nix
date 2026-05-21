{ pkgs, ... }:

# Standalone dev shell. Sibling to flake.nix / nix/ — `devenv shell`
# is the fast iteration path; `nix develop` and `nix build .#paperclip`
# use the flake (which embeds the same gotchas: shamefully-hoist,
# distutils shim, NODE_OPTIONS). The two trees are deliberately
# independent so neither depends on the other to evaluate.

{
  # Node + pnpm toolchain. Matches Dockerfile (node:lts-trixie-slim →
  # Node 22 LTS), CI (pr.yml, release.yml use node-version: 24 — Node 22
  # is the LTS compromise) and package.json engines `>=20`.
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    pnpm.enable = true;
    # Do NOT auto-install: this workspace has a `preflight:workspace-links`
    # step and `scripts/link-plugin-dev-sdk.mjs` that contributors should
    # see run interactively the first time.
  };

  # V8's default ~1.7 GB old-space cap trips
  # `Ineffective mark-compacts near heap limit` during `pnpm build` and
  # the heavier vitest runs. 4 GiB clears every observed workspace build.
  env.NODE_OPTIONS = "--max-old-space-size=4096";

  # Optional dev Postgres matching .env.example. DATABASE_URL is NOT
  # exported here, so `pnpm dev` keeps using embedded PGlite by default
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

  packages = with pkgs; [
    git
    gh
    jq
    ripgrep
    curl
    wget
    openssh # ssh-based git remotes + adapter subprocesses
    vips # native dep for `sharp` (image processing)
    pkg-config # `sharp` / `better-sqlite3` discover vips/sqlite via this
    # node-gyp@8 imports Python 3.12's removed `distutils` module;
    # setuptools provides the compatibility shim.
    (python3.withPackages (ps: [ ps.setuptools ]))
  ];

  enterShell = ''
    # devenv's languages.javascript.pnpm.enable already puts pnpm 9 on
    # PATH. The `packageManager: "pnpm@9.15.4"` pin in package.json
    # then takes over once `pnpm` is invoked in the workspace (pnpm
    # has its own self-management — no `corepack enable` needed, and
    # corepack would fail anyway trying to symlink into the read-only
    # nix store).

    echo "paperclip dev shell — Node $(node --version), pnpm $(pnpm --version)"
    echo ""
    echo "Database:"
    echo "  Default (PGlite):   leave DATABASE_URL unset, run 'pnpm dev'"
    echo "  Real Postgres:      'devenv up' then"
    echo "                      'export DATABASE_URL=postgres://paperclip:paperclip@localhost:5432/paperclip'"
  '';
}
