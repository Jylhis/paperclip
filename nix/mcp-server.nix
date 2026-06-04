{
  lib,
  stdenv,
  nodejs_22,
  pnpm_9,
  fetchPnpmDeps,
  pnpmConfigHook,
  makeWrapper,
  cacert,
}:
# `@paperclipai/mcp-server` — thin MCP wrapper over the Paperclip REST API.
# Has no native dependencies (only @modelcontextprotocol/sdk + zod), so this
# builds darwin + linux without the vips / sqlite native-rebuild dance that
# the main `paperclip` derivation needs.
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
  pname = "paperclip-mcp-server";
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
    # Same flat-layout requirement as the main paperclip derivation —
    # the bundle resolves bare imports from the root `node_modules`.
    printf 'shamefully-hoist=true\n' >> .npmrc
  '';

  COREPACK_ENABLE_STRICT = "0";

  NODE_OPTIONS = "--max-old-space-size=4096";

  buildPhase = ''
    runHook preBuild

    pnpm --filter @paperclipai/shared build
    pnpm --filter @paperclipai/mcp-server build

    test -f packages/mcp-server/dist/stdio.js \
      || (echo "ERROR: mcp-server build output missing" >&2; exit 1)

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/paperclip-mcp-server
    # Carry the whole workspace tree — pnpm's symlinked `node_modules`
    # layout makes per-package pruning unsafe. Same approach as the main
    # paperclip derivation.
    cp -r --reflink=auto . $out/lib/paperclip-mcp-server/

    mkdir -p $out/bin
    makeWrapper ${nodejs}/bin/node $out/bin/paperclip-mcp-server \
      --add-flags "$out/lib/paperclip-mcp-server/packages/mcp-server/dist/stdio.js" \
      --set NODE_ENV production

    runHook postInstall
  '';

  doCheck = false;

  dontStrip = true;
  dontPatchELF = true;

  meta = {
    description = "Paperclip MCP server (thin REST wrapper for Claude Desktop / IDE MCP clients)";
    homepage = "https://github.com/paperclipai/paperclip";
    license = lib.licenses.mit;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
      "x86_64-darwin"
    ];
    mainProgram = "paperclip-mcp-server";
  };
})
