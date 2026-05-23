{
  lib,
  stdenv,
  nodejs_22,
  pnpm_9,
  fetchPnpmDeps,
  pnpmConfigHook,
  makeWrapper,
  cacert,
  git,
  gh,
  ripgrep,
  openssh,
  jq,
  coreutils,
  bash,
  curl,
  wget,
}:
# Standalone `paperclipai` CLI derivation — bundles only the cli workspace via
# the existing esbuild config (`cli/esbuild.config.mjs`). Builds darwin + linux
# because the bundle has no native build steps; sharp / sqlite / vips are
# server-only concerns. The main `paperclip` derivation continues to ship its
# own `bin/paperclipai` for the NixOS module; this one exists so macOS users
# can install the CLI standalone.
let
  nodejs = nodejs_22;
  pnpm = pnpm_9.override { inherit nodejs; };

  workspace = import ./lib.nix {
    inherit
      lib
      fetchPnpmDeps
      nodejs_22
      pnpm_9
      ;
  };
in
stdenv.mkDerivation (finalAttrs: {
  pname = "paperclipai";
  inherit (workspace) version src pnpmDeps;
  passthru = {
    inherit (workspace) pnpmDeps pnpmDepsHash;
  };

  nativeBuildInputs = [
    nodejs
    pnpm
    (pnpmConfigHook.override { inherit pnpm; })
    makeWrapper
    cacert
  ];

  postPatch = ''
    printf 'shamefully-hoist=true\n' >> .npmrc
  '';

  COREPACK_ENABLE_STRICT = "0";

  NODE_OPTIONS = "--max-old-space-size=4096";

  buildPhase = ''
    runHook preBuild

    # plugin-sdk is a transitive workspace dep that the CLI's bundling
    # walks; build it first so esbuild can resolve its sources.
    pnpm --filter @paperclipai/plugin-sdk build
    pnpm --filter paperclipai build

    test -f cli/dist/index.js \
      || (echo "ERROR: paperclipai bundle output missing" >&2; exit 1)

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/paperclipai
    cp -r --reflink=auto . $out/lib/paperclipai/

    mkdir -p $out/bin
    runtimePath=${
      lib.makeBinPath [
        nodejs
        git
        gh
        ripgrep
        openssh
        jq
        coreutils
        bash
        curl
        wget
      ]
    }

    makeWrapper ${nodejs}/bin/node $out/bin/paperclipai \
      --add-flags "$out/lib/paperclipai/cli/dist/index.js" \
      --prefix PATH : "$runtimePath" \
      --set NODE_ENV production

    runHook postInstall
  '';

  doCheck = false;

  dontStrip = true;
  dontPatchELF = true;

  meta = {
    description = "Paperclip orchestration CLI (standalone, no server bundle)";
    homepage = "https://github.com/paperclipai/paperclip";
    license = lib.licenses.mit;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
      "x86_64-darwin"
    ];
    mainProgram = "paperclipai";
  };
})
