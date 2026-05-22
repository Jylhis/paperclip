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

      # `nixosTest` only runs on linux. Each test boots a VM, brings the unit
      # up, and exercises `/health` to catch regressions in the module wiring
      # (bind presets, postgres password rotation, env-file ordering).
      checks = forSystems linuxSystems (pkgs: {
        module-default = pkgs.callPackage ./nix/tests/module-default.nix {
          paperclipModule = self.nixosModules.paperclip;
          paperclipOverlay = self.overlays.default;
        };
        module-postgres = pkgs.callPackage ./nix/tests/module-postgres.nix {
          paperclipModule = self.nixosModules.paperclip;
          paperclipOverlay = self.overlays.default;
        };
      });

      devShells = forSystems shellSystems (pkgs: {
        default = pkgs.callPackage ./nix/shell.nix { };
      });

      formatter = forSystems shellSystems (pkgs: pkgs.nixfmt);
    };
}
