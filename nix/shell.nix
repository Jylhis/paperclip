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
}:

# Slim dev shell exposed as `flake#devShells.default`. The richer
# devenv shell lives in ../devenv.nix; this is the `nix develop`
# entry point and is intentionally kept independent so users without
# devenv can still get the toolchain via `nix develop`.

mkShell {
  packages = [
    nodejs_22
    pnpm_9
    (python3.withPackages (ps: [ ps.setuptools ]))
    vips
    pkg-config
    git
    gh
    ripgrep
    openssh
    jq
    curl
    wget
  ];

  shellHook = ''
    # pnpm 9 from nixpkgs is on PATH; the workspace's
    # `packageManager: "pnpm@9.15.4"` pin takes over from there.
    # No `corepack enable` — it would try to symlink into the
    # read-only nix store and fail.
    # V8 default old-space (~1.7 GB) trips during the workspace build.
    export NODE_OPTIONS="''${NODE_OPTIONS:---max-old-space-size=4096}"
  '';
}
