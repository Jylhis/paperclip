{
  mkShell,
  nodejs_22,
  pnpm_9,
  python3,
  vips,
  pkg-config,
  git,
  gh,
  ripgrep,
  openssh,
  jq,
  curl,
  wget,
  gnutar,
  zstd,
}:

# Slim dev shell exposed as `flake#devShells.default`. The richer devenv
# shell lives in ../devenv.nix, but both consume the same toolchain helper
# so Node/pnpm/native-build inputs stay aligned.

let
  toolchain = import ./dev-toolchain.nix {
    inherit
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
mkShell {
  packages = toolchain.packages;

  shellHook = ''
    # pnpm 9 from nixpkgs is on PATH; the workspace's
    # `packageManager: "pnpm@9.15.4"` pin takes over from there.
    # No `corepack enable` — it would try to symlink into the
    # read-only nix store and fail.
    export PATH="${toolchain.nodejs}/bin:${toolchain.pnpm}/bin:$PATH"
    # V8 default old-space (~1.7 GB) trips during the workspace build.
    export NODE_OPTIONS="''${NODE_OPTIONS:-${toolchain.nodeOptions}}"
  '';
}
