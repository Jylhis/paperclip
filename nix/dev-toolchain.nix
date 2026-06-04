{
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

let
  nodejs = nodejs_22;
  pnpm = pnpm_9.override { inherit nodejs; };
  pythonWithSetuptools = python3.withPackages (ps: [ ps.setuptools ]);
in
{
  inherit nodejs pnpm;
  nodeOptions = "--max-old-space-size=4096";

  packages = [
    nodejs
    pnpm
    pythonWithSetuptools
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
  ];

  inherit pythonWithSetuptools;
}
