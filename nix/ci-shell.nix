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
  hadolint,
  actionlint,
}:

# CI dev shell exposed as `flake#devShells.ci`. It is the slim `nix develop`
# shell (../nix/shell.nix) plus the two lint tools CI used to curl from GitHub
# releases (hadolint, actionlint). Workflows enter it with
# `nix develop .#ci --command …` so every CI tool comes from one pinned
# nixpkgs, matching local dev and the Dockerfile.

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
  packages = toolchain.packages ++ [
    hadolint
    actionlint
  ];

  shellHook = ''
    # Same as nix/shell.nix: pnpm/Node from nix on PATH, no corepack, and a
    # 4 GiB V8 old-space so heavier vitest/build runs do not OOM.
    export PATH="${toolchain.nodejs}/bin:${toolchain.pnpm}/bin:$PATH"
    export NODE_OPTIONS="''${NODE_OPTIONS:-${toolchain.nodeOptions}}"
  '';
}
