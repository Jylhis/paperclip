{
  description = "Paperclip — open-source control plane for AI-agent companies";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      # The server + agent-CLI bundles are Linux-only (matches the production
      # deployment shape). The dev shell and the lighter outputs
      # (paperclip-mcp-server, paperclipai, paperclip-ui) additionally support
      # darwin so contributors and MCP users on macOS get first-class support.
      linuxSystems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      shellSystems = linuxSystems ++ [
        "aarch64-darwin"
        "x86_64-darwin"
      ];

      # `paperclip-agent-clis` bundles proprietary upstream binaries
      # (claude-code, codex, opencode). Allowlist them by name so
      # `nix flake check` and `nix build` work without consumers
      # having to set `NIXPKGS_ALLOW_UNFREE=1`.
      forSystems =
        systems: f:
        nixpkgs.lib.genAttrs systems (
          system:
          f (
            import nixpkgs {
              inherit system;
              config.allowUnfreePredicate =
                pkg:
                builtins.elem (nixpkgs.lib.getName pkg) [
                  "paperclip-agent-clis"
                  "claude-code"
                  "codex"
                  "opencode"
                ];
            }
          )
        );

      crossPlatformPackages = forSystems shellSystems (pkgs: {
        paperclip-mcp-server = pkgs.callPackage ./nix/mcp-server.nix { };
        paperclipai = pkgs.callPackage ./nix/paperclipai.nix { };
        paperclip-ui = pkgs.callPackage ./nix/ui.nix { };
        paperclip-pnpm-deps =
          (import ./nix/lib.nix {
            inherit (pkgs)
              lib
              fetchPnpmDeps
              nodejs_22
              pnpm_9
              ;
          }).pnpmDeps;
      });

      linuxOnlyPackages = forSystems linuxSystems (pkgs: rec {
        paperclip = pkgs.callPackage ./nix/package.nix { };
        paperclip-agent-clis = pkgs.callPackage ./nix/agent-clis.nix {
          inherit (pkgs.stdenv.hostPlatform) system;
        };
        default = paperclip;
      });
    in
    {
      # `recursiveUpdate` lets darwin systems expose only the cross-platform
      # outputs while linux systems get those plus `paperclip` /
      # `paperclip-agent-clis` / `default`.
      packages = nixpkgs.lib.recursiveUpdate crossPlatformPackages linuxOnlyPackages;

      overlays.default = import ./nix/overlay.nix;

      nixosModules.paperclip = import ./nix/modules/nixos/paperclip.nix;
      nixosModules.default = self.nixosModules.paperclip;

      # Pure-eval module smoke check. Cheap (no VM boot), catches option-type
      # errors, assertion bugs, and missing systemd attrs on every
      # `nix flake check`. The heavy VM tests live in `vmTests` below.
      checks = forSystems linuxSystems (pkgs: {
        module-eval = pkgs.callPackage ./nix/tests/module-eval.nix {
          paperclipModule = self.nixosModules.paperclip;
          paperclipPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.paperclip;
        };
      });

      # NixOS VM tests are heavy (each boots a full VM). Keep them OUT of
      # `flake.checks` so `nix flake check` stays fast — operators run
      # them via `just test-vm` or `nix build .#vmTests.<system>.<name>`
      # when explicitly requested.
      vmTests = forSystems linuxSystems (pkgs: {
        module-default = pkgs.callPackage ./nix/tests/module-default.nix {
          paperclipModule = self.nixosModules.paperclip;
          paperclipPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.paperclip;
        };
        module-postgres = pkgs.callPackage ./nix/tests/module-postgres.nix {
          paperclipModule = self.nixosModules.paperclip;
          paperclipPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.paperclip;
        };
        module-tailnet = pkgs.callPackage ./nix/tests/module-tailnet.nix {
          paperclipModule = self.nixosModules.paperclip;
          paperclipPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.paperclip;
        };
        module-external = pkgs.callPackage ./nix/tests/module-external.nix {
          paperclipModule = self.nixosModules.paperclip;
          paperclipPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.paperclip;
        };
        module-grafana = pkgs.callPackage ./nix/tests/module-grafana.nix {
          paperclipModule = self.nixosModules.paperclip;
          paperclipPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.paperclip;
        };
        module-caddy = pkgs.callPackage ./nix/tests/module-caddy.nix {
          paperclipModule = self.nixosModules.paperclip;
          paperclipPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.paperclip;
        };
        module-custom-bind = pkgs.callPackage ./nix/tests/module-custom-bind.nix {
          paperclipModule = self.nixosModules.paperclip;
          paperclipPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.paperclip;
        };
        module-authenticated = pkgs.callPackage ./nix/tests/module-authenticated.nix {
          paperclipModule = self.nixosModules.paperclip;
          paperclipPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.paperclip;
        };
      });

      devShells = forSystems shellSystems (pkgs: {
        default = pkgs.callPackage ./nix/shell.nix { };
      });

      apps = forSystems shellSystems (
        pkgs:
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
          install-deps = {
            type = "app";
            program = "${
              pkgs.writeShellApplication {
                name = "paperclip-install-deps";
                runtimeInputs = [
                  pkgs.bash
                  pkgs.git
                  pkgs.gnutar
                  pkgs.nix
                  pkgs.zstd
                ];
                text = ''
                  export PAPERCLIP_NIX_PATH_PREFIX="${toolchain.nodejs}/bin:${toolchain.pnpm}/bin"
                  exec ${pkgs.bash}/bin/bash ${./scripts/nix-pnpm-install.sh} "$@"
                '';
              }
            }/bin/paperclip-install-deps";
            meta.description = "Materialise Paperclip node_modules from the Nix-prefetched PNPM store";
          };
        }
      );

      formatter = forSystems shellSystems (pkgs: pkgs.nixfmt);
    };
}
