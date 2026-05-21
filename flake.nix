{
  description = "Paperclip — open-source control plane for AI-agent companies";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      # Package + agent-CLI bundles are Linux-only (matches the
      # production deployment shape). The dev shell additionally
      # supports darwin so contributors on macOS can `nix develop`.
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
    in
    {
      packages = forSystems linuxSystems (pkgs: rec {
        paperclip = pkgs.callPackage ./nix/package.nix { };
        paperclip-agent-clis = pkgs.callPackage ./nix/agent-clis.nix {
          inherit (pkgs.stdenv.hostPlatform) system;
        };
        default = paperclip;
      });

      overlays.default = import ./nix/overlay.nix;

      nixosModules.paperclip = import ./nix/modules/nixos/paperclip.nix;
      nixosModules.default = self.nixosModules.paperclip;

      devShells = forSystems shellSystems (pkgs: {
        default = pkgs.callPackage ./nix/shell.nix { };
      });

      formatter = forSystems shellSystems (pkgs: pkgs.nixfmt);
    };
}
