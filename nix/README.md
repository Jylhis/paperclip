# Nix support

This directory ships paperclip as a Nix package, an overlay, and a
NixOS service module, plus a `nix develop` shell.

## Outputs

`flake.nix` (repo root) exposes:

| Output                              | What                                                 |
| ----------------------------------- | ---------------------------------------------------- |
| `packages.<sys>.paperclip`          | The server + bundled `paperclipai` CLI               |
| `packages.<sys>.paperclip-agent-clis` | Bundled `claude-code`, `codex`, `opencode`         |
| `packages.<sys>.default`            | Alias for `paperclip`                                |
| `overlays.default`                  | Adds `paperclip` and `paperclip-agent-clis` to `pkgs` |
| `nixosModules.paperclip`            | `services.paperclip.enable = true`                   |
| `devShells.<sys>.default`           | `nix develop` toolchain                              |

Package + agent-CLI platforms: `x86_64-linux`, `aarch64-linux`.
The dev shell additionally supports `aarch64-darwin` and
`x86_64-darwin`.

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
            database = {
              mode = "postgresql";
              passwordFile = "/run/secrets/paperclip_db_password";
            };
            publicUrl = "https://paperclip.example.com";
            environmentFile = "/run/secrets/paperclip.env";
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

## Build locally

```sh
nix build .#paperclip        # server + CLI
nix build .#paperclip-agent-clis   # Linux-only
nix develop                  # toolchain shell
```

The first `nix build .#paperclip` will fail with a `pnpmDeps` hash
mismatch. Copy the printed `got:` hash into `nix/package.nix`
(`pnpmDeps.hash`) and re-run. This is normal — every
`pnpm-lock.yaml` change triggers it.

## Layout

```
nix/
  package.nix              # paperclip derivation
  agent-clis.nix           # claude-code + codex + opencode bundle
  overlay.nix              # final: prev: { paperclip = ...; }
  shell.nix                # flake devShell
  modules/nixos/
    paperclip.nix          # services.paperclip NixOS module
```

`devenv.nix` at the repo root is independent — a faster iteration
shell for contributors who already use devenv.sh. Both trees pin
Node 22 + pnpm 9 and share the same workarounds
(`shamefully-hoist=true`, distutils shim, `NODE_OPTIONS`).
