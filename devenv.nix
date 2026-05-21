{ pkgs, ... }:

{
  # Node + pnpm toolchain. Matches Dockerfile (node:lts-trixie-slim →
  # Node 22 LTS) and package.json engines `>=20`.
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    pnpm.enable = true;
    # Do NOT auto-install: this workspace has a `preflight:workspace-links`
    # step and `scripts/link-plugin-dev-sdk.mjs` that contributors should
    # see run interactively the first time.
  };

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
    python3
  ];

  enterShell = ''
    echo "paperclip dev shell — Node $(node --version), pnpm $(pnpm --version)"
    echo ""
    echo "Database:"
    echo "  Default (PGlite):   leave DATABASE_URL unset, run 'pnpm dev'"
    echo "  Real Postgres:      'devenv up' then"
    echo "                      'export DATABASE_URL=postgres://paperclip:paperclip@localhost:5432/paperclip'"
  '';
}
