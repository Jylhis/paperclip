# Nix support

This directory ships paperclip as a Nix package, an overlay, and a
NixOS service module, plus a `nix develop` shell.

## Outputs

`flake.nix` (repo root) exposes:

| Output                                  | What                                                    |
| --------------------------------------- | ------------------------------------------------------- |
| `packages.<sys>.paperclip`              | The server + bundled `paperclipai` CLI                  |
| `packages.<sys>.paperclip-agent-clis`   | Bundled `claude-code`, `codex`, `opencode` (unfree)     |
| `packages.<sys>.paperclip-mcp-server`   | `@paperclipai/mcp-server` standalone with `bin/paperclip-mcp-server` |
| `packages.<sys>.paperclipai`            | Standalone `paperclipai` CLI (no server bundle)         |
| `packages.<sys>.paperclip-ui`           | Prebuilt board UI static assets under `share/paperclip-ui/` |
| `packages.<sys>.default`                | Alias for `paperclip` (Linux only)                      |
| `overlays.default`                      | Adds all of the above to `pkgs`                         |
| `nixosModules.paperclip`                | `services.paperclip.enable = true`                      |
| `checks.<sys>.module-default`           | NixOS VM test: embedded DB + nginx proxy                |
| `checks.<sys>.module-postgres`          | NixOS VM test: NixOS-managed Postgres                   |
| `devShells.<sys>.default`               | `nix develop` toolchain                                 |

Platform support:

| Output                  | x86_64-linux | aarch64-linux | aarch64-darwin | x86_64-darwin |
| ----------------------- | :----------: | :-----------: | :------------: | :-----------: |
| `paperclip`             | ✅           | ✅            | ❌             | ❌            |
| `paperclip-agent-clis`  | ✅           | ✅            | ❌             | ❌            |
| `paperclip-mcp-server`  | ✅           | ✅            | ✅             | ✅            |
| `paperclipai`           | ✅           | ✅            | ✅             | ✅            |
| `paperclip-ui`          | ✅           | ✅            | ✅             | ✅            |
| `devShells.default`     | ✅           | ✅            | ✅             | ✅            |
| `checks.*`              | ✅           | ✅            | ❌             | ❌            |

`paperclip-agent-clis` is Linux-only because the upstream npm packages
ship per-arch tarballs only for `linux-x64` / `linux-arm64`. `checks.*`
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
  deploymentMode = "authenticated";
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
nix flake check                       # runs nixosTests on Linux
nix develop                           # toolchain shell
```

The first build after a `pnpm-lock.yaml` change will fail with a
`pnpmDeps` hash mismatch. Re-pin in **one** place — `nix/lib.nix`:

1. Replace `pnpmDepsHash` in `nix/lib.nix` with `lib.fakeHash`.
2. Run `nix build .#paperclip.pnpmDeps --system x86_64-linux` on a
   builder with a generous fixupPhase timeout (nixbuild.net's default
   60 s kills the fixup on this tree).
3. Copy the printed `got:` hash back into `pnpmDepsHash`.

All five derivations (`paperclip`, `paperclip-mcp-server`, `paperclipai`,
`paperclip-ui`, and any future workspace derivation) share the same
hash via `nix/lib.nix`, so one re-pin covers everything.

## Layout

```
nix/
  lib.nix                  # shared src filter + pnpmDeps hash
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
    module-default.nix     # nixosTest: embedded DB + nginx proxy
    module-postgres.nix    # nixosTest: NixOS-managed Postgres
```

`devenv.nix` at the repo root is independent — a faster iteration
shell for contributors who already use devenv.sh. Both trees pin
Node 22 + pnpm 9 and share the same workarounds
(`shamefully-hoist=true`, distutils shim, `NODE_OPTIONS`).
