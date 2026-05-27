# Nix support

This directory ships paperclip as a Nix package, an overlay, and a
NixOS service module, plus a `nix develop` shell.

## On macOS? Install just the CLI

`paperclipai` is the standalone CLI without the server bundle — works
on darwin, useful for laptops that just need to talk to a remote
Paperclip instance:

```sh
nix profile install github:Jylhis/paperclip#paperclipai
paperclipai env doctor
```

The full `paperclip` package (server + native modules) is Linux-only.
See [Standalone CLI](#standalone-cli-darwin--no-server-hosts) below
for the caveats around the darwin build.

## Outputs

`flake.nix` (repo root) exposes:

| Output                                  | What                                                    |
| --------------------------------------- | ------------------------------------------------------- |
| `packages.<sys>.paperclip`              | The server + bundled `paperclipai` CLI                  |
| `packages.<sys>.paperclip-agent-clis`   | Bundled `claude-code`, `codex`, `opencode` (unfree)     |
| `packages.<sys>.paperclip-mcp-server`   | `@paperclipai/mcp-server` standalone with `bin/paperclip-mcp-server` |
| `packages.<sys>.paperclipai`            | Standalone `paperclipai` CLI (no server bundle)         |
| `packages.<sys>.paperclip-ui`           | Prebuilt board UI static assets under `share/paperclip-ui/` |
| `packages.<sys>.paperclip-pnpm-deps`    | Fixed-output PNPM store fetched from `pnpm-lock.yaml`   |
| `packages.<sys>.default`                | Alias for `paperclip` (Linux only)                      |
| `overlays.default`                      | Adds all of the above to `pkgs`                         |
| `nixosModules.paperclip`                | `services.paperclip.enable = true`                      |
| `vmTests.<sys>.module-default`          | NixOS VM test: NixOS-managed PG + nginx proxy           |
| `vmTests.<sys>.module-postgres`         | NixOS VM test: NixOS-managed PG (canonical, PG 17 pin)  |
| `vmTests.<sys>.module-tailnet`          | NixOS VM test: `listen.mode = "tailnet"` shim           |
| `vmTests.<sys>.module-external`         | NixOS VM test: external DB + `migrationUrl`             |
| `devShells.<sys>.default`               | `nix develop` toolchain                                 |
| `apps.<sys>.install-deps`               | Materialise local `node_modules` from the Nix PNPM store |

VM tests live under `vmTests.<sys>.*` rather than `checks.<sys>.*` so
they do not run on every `nix flake check`. Invoke them through the
repo `justfile` (`just test-vm`, `just test-vm-external`, etc.) or
directly via `nix build .#vmTests.<sys>.<name>`.

Platform support. The `nixosModules.paperclip` row only makes sense
on Linux because `pkgs.paperclip` (which the module defaults to) is
Linux-only — importing the module on darwin is harmless as long as
`enable = false`, but enabling it on darwin requires
`services.paperclip.package` to be set to something that exists there.

| Output                       | x86_64-linux | aarch64-linux | aarch64-darwin | x86_64-darwin |
| ---------------------------- | :----------: | :-----------: | :------------: | :-----------: |
| `paperclip`                  | ✅           | ✅            | ❌             | ❌            |
| `paperclip-agent-clis`       | ✅           | ✅            | ❌             | ❌            |
| `paperclip-mcp-server`       | ✅           | ✅            | ✅             | ✅            |
| `paperclipai`                | ✅           | ✅            | ✅             | ✅            |
| `paperclip-ui`               | ✅           | ✅            | ✅             | ✅            |
| `paperclip-pnpm-deps`        | ✅           | ✅            | ✅             | ✅            |
| `devShells.default`          | ✅           | ✅            | ✅             | ✅            |
| `vmTests.*`                  | ✅           | ✅            | ❌             | ❌            |
| `nixosModules.paperclip`     | ✅           | ✅            | ❌             | ❌            |

`paperclip-agent-clis` is Linux-only because the upstream npm packages
ship per-arch tarballs only for `linux-x64` / `linux-arm64`. `vmTests.*`
runs `nixosTest`, which only works on Linux. The lighter outputs
(`paperclip-mcp-server`, `paperclipai`, `paperclip-ui`) are pure JS
bundles with no native build steps, so they cover darwin too.

## Consume from another flake

```nix
{
  inputs.paperclip.url = "github:Jylhis/paperclip";

  outputs = { self, nixpkgs, paperclip, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        paperclip.nixosModules.paperclip
        ({ ... }: {
          nixpkgs.overlays = [ paperclip.overlays.default ];
          services.paperclip = {
            enable = true;
            deploymentMode = "authenticated";
            database = {
              mode = "postgresql";
              passwordFile = "/run/secrets/paperclip_db_password";
            };
            publicUrl = "https://paperclip.example.com";
            # Must contain at minimum BETTER_AUTH_SECRET when
            # deploymentMode = "authenticated" — Better Auth refuses to
            # sign cookies without it. Add OPENAI_API_KEY / ANTHROPIC_API_KEY
            # here too if you use those providers.
            environmentFile = "/run/secrets/paperclip.env";
            # Synthesised nginx vhost in front, ACME-managed cert.
            proxy.nginx = true;
            proxy.enableACME = true;
          };
        })
      ];
    };
  };
}
```

Note the overlay is what makes `pkgs.paperclip` resolve inside the
module. If you skip it, set `services.paperclip.package` explicitly:

```nix
services.paperclip.package = paperclip.packages.${pkgs.system}.paperclip;
```

## Reverse-proxy options

The NixOS module can synthesise an nginx or Caddy vhost in front of
paperclip — saves writing the proxy block by hand, derives the server
name from `publicUrl`, and wires up websocket upgrades automatically.

```nix
services.paperclip = {
  enable = true;
  publicUrl = "https://desk.example.com";
  proxy.nginx = true;        # OR proxy.caddy = true (not both)
  proxy.enableACME = true;   # security.acme cert for the nginx vhost
  proxy.extraConfig = ''     # appended into the location/site block
    client_max_body_size 50m;
  '';
};
```

`proxy.nginx` and `proxy.caddy` are mutually exclusive. Caddy
negotiates ACME on its own when the vhost name resolves publicly, so
`enableACME` is wired up for the nginx branch only.

## MCP server

`packages.<sys>.paperclip-mcp-server` ships the same code published as
`@paperclipai/mcp-server`. Use it for Claude Desktop / IDE MCP
integrations pointing at a remote Paperclip instance:

```json
{
  "mcpServers": {
    "paperclip": {
      "command": "/run/current-system/sw/bin/paperclip-mcp-server",
      "env": {
        "PAPERCLIP_API_URL": "https://desk.example.com",
        "PAPERCLIP_API_KEY": "…"
      }
    }
  }
}
```

The wrapper expects at minimum `PAPERCLIP_API_URL` and
`PAPERCLIP_API_KEY`; see `packages/mcp-server/README.md` for the full
env surface.

## Standalone CLI (darwin / no-server hosts)

`packages.<sys>.paperclipai` is the CLI alone — same bundle the main
package wraps, without the server / vips / sqlite native build steps.
Use it on macOS or any host where you just want `paperclipai` to talk
to a remote Paperclip instance:

```sh
nix profile install github:Jylhis/paperclip#paperclipai
paperclipai env doctor
```

Caveat: this build skips the rebuild step for native modules, so
`paperclipai server` (and any local embedded-Postgres path) will not
work — use the full `paperclip` package on Linux for that.

## Static UI assets

`packages.<sys>.paperclip-ui` is the prebuilt board UI. Drop the
directory into an nginx `root` to serve the UI from a separate host
while the API runs elsewhere:

```nix
services.nginx.virtualHosts."ui.example.com".root =
  "${pkgs.paperclip-ui}/share/paperclip-ui";

services.paperclip = {
  enable = true;
  serveUi = false;                     # API only on this host
  apiUrl  = "https://api.example.com"; # what the UI hits
};
```

## Build locally

```sh
nix build .#paperclip                 # server + CLI (Linux only)
nix build .#paperclip-agent-clis      # Linux only
nix build .#paperclip-mcp-server      # any system
nix build .#paperclipai               # any system
nix build .#paperclip-ui              # any system
nix build .#paperclip-pnpm-deps       # prefetched PNPM store
nix run .#install-deps                # local node_modules, offline via Nix store
nix flake check                       # eval-only sanity check (fast)
just test-vm                          # run every NixOS VM test (heavy)
just test-vm-external                 # single VM test (see justfile)
nix develop                           # toolchain shell
```

The first build after a `pnpm-lock.yaml` change will fail with a
`pnpmDeps` hash mismatch. Re-pin in **one** place — `nix/lib.nix`:

1. Replace `pnpmDepsHash` in `nix/lib.nix` with `lib.fakeHash`.
2. Run `nix build .#paperclip-pnpm-deps --system x86_64-linux` on a
   builder with a generous fixupPhase timeout (nixbuild.net's default
   60 s kills the fixup on this tree).
3. Copy the printed `got:` hash back into `pnpmDepsHash`.

All workspace derivations (`paperclip`, `paperclip-mcp-server`,
`paperclipai`, `paperclip-ui`, `paperclip-pnpm-deps`, and any future
workspace derivation) share the same hash via `nix/lib.nix`, so one
re-pin covers everything.

Paperclip intentionally uses Nixpkgs `fetchPnpmDeps` and `pnpmConfigHook`
instead of `pnpm2nix`: this workspace has a v9 `pnpm-lock.yaml`, while
`pnpm2nix` is unmaintained and only supports lockfile v5 or below.

## Layout

```
nix/
  lib.nix                  # shared src filter + pnpmDeps hash
  dev-toolchain.nix        # shared nix develop / devenv Node+pnpm toolchain
  package.nix              # paperclip derivation (server + CLI)
  paperclipai.nix          # standalone CLI
  mcp-server.nix           # @paperclipai/mcp-server
  ui.nix                   # @paperclipai/ui static assets
  agent-clis.nix           # claude-code + codex + opencode bundle
  overlay.nix              # final: prev: { paperclip = ...; ... }
  shell.nix                # flake devShell
  modules/nixos/
    paperclip.nix          # services.paperclip NixOS module
  tests/
    module-default.nix     # nixosTest: NixOS-managed PG + nginx proxy
    module-postgres.nix    # nixosTest: NixOS-managed PG (PG 17 pin)
    module-tailnet.nix     # nixosTest: listen.mode = "tailnet"
    module-external.nix    # nixosTest: external DB + migrationUrl
```

`devenv.nix` at the repo root is a faster iteration shell for
contributors who already use devenv.sh. It consumes the same
`nix/dev-toolchain.nix` helper as `nix develop`, so Node 22, pnpm 9,
the native build inputs, and `NODE_OPTIONS` stay aligned.
