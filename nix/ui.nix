{
  lib,
  stdenv,
  nodejs_22,
  pnpm_9,
  fetchPnpmDeps,
  pnpmConfigHook,
  cacert,
}:
# Prebuilt Paperclip board UI as a static-asset derivation. Output lands in
# `$out/share/paperclip-ui/` ready to drop into an nginx `root` directive or a
# CDN bucket, for operators who want to serve the UI separately from the
# API server (point `services.paperclip.apiUrl` at the API host).
let
  pnpm = pnpm_9;
  nodejs = nodejs_22;

  workspace = import ./lib.nix { inherit lib fetchPnpmDeps pnpm_9; };
in
stdenv.mkDerivation {
  pname = "paperclip-ui";
  inherit (workspace) version src pnpmDeps;

  nativeBuildInputs = [
    nodejs
    pnpm
    (pnpmConfigHook.override { pnpm = pnpm_9; })
    cacert
  ];

  postPatch = ''
    printf 'shamefully-hoist=true\n' >> .npmrc
  '';

  COREPACK_ENABLE_STRICT = "0";

  NODE_OPTIONS = "--max-old-space-size=4096";

  buildPhase = ''
    runHook preBuild

    pnpm --filter @paperclipai/plugin-sdk build
    pnpm --filter @paperclipai/ui build

    test -d ui/dist \
      || (echo "ERROR: ui/dist missing — vite build did not produce assets" >&2; exit 1)

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/paperclip-ui
    cp -r --reflink=auto ui/dist/. $out/share/paperclip-ui/

    runHook postInstall
  '';

  doCheck = false;

  meta = {
    description = "Prebuilt Paperclip board UI static assets";
    homepage = "https://github.com/paperclipai/paperclip";
    license = lib.licenses.mit;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
      "x86_64-darwin"
    ];
  };
}
