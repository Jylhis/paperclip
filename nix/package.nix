{
  lib,
  stdenv,
  nodejs_22,
  pnpm_9,
  fetchPnpmDeps,
  pnpmConfigHook,
  makeWrapper,
  cacert,
  # node-gyp@8 (bundled in the Node 20+ ecosystem) imports `distutils`,
  # which Python 3.12+ removed. Use a Python with setuptools, which
  # ships a `distutils` compatibility shim.
  python3,
  vips,
  pkg-config,
  # Runtime PATH deps kept in sync with upstream Dockerfile. Tailscale
  # is *not* listed here — it is a site-specific runtime that the
  # NixOS module adds via `systemd.services.paperclip.path` instead.
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
  pname = "paperclip";
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
    (python3.withPackages (ps: [ ps.setuptools ]))
    pkg-config
  ];

  buildInputs = [
    vips # sharp native build
  ];

  postPatch = ''
    # The cli workspace is bundled by esbuild with all npm deps
    # outside @paperclipai/* marked external — so at runtime
    # `cli/dist/index.js` does bare `import 'zod'` etc. and Node's
    # ESM resolver walks up looking for `node_modules/<pkg>`. pnpm
    # v9's default isolated layout puts deps under each workspace's
    # own `node_modules` rather than at the root, so the walk misses
    # everything. shamefully-hoist flips pnpm to a flat layout (deps
    # land at the root `node_modules`), which is what the bundle's
    # resolution actually needs.
    printf 'shamefully-hoist=true\n' >> .npmrc
  '';

  # `pnpmDeps` is consumed by `pnpmConfigHook` above; the hash + src filter
  # live in `nix/lib.nix` so every workspace derivation (paperclip,
  # paperclip-mcp-server, paperclipai, paperclip-ui) re-pins from a single
  # location. See `nix/README.md` for the re-pin procedure.

  COREPACK_ENABLE_STRICT = "0";

  npm_config_nodedir = nodejs;

  npm_config_python = "${python3.withPackages (ps: [ ps.setuptools ])}/bin/python";

  # esbuild/tsc on the full pnpm workspace blow past V8's default ~1.7 GB
  # old-space and trip `Ineffective mark-compacts near heap limit` on
  # small builders. 4 GiB clears every workspace build observed so far.
  NODE_OPTIONS = "--max-old-space-size=4096";

  buildPhase = ''
    runHook preBuild

    rebuild_node_module() {
      local pkg="$1"
      local pkg_dir
      pkg_dir=$(echo node_modules/.pnpm/"$pkg"@*/node_modules/"$pkg")
      if [ ! -d "$pkg_dir" ]; then
        echo "skip $pkg (not installed)" >&2
        return 0
      fi
      echo "Building native module: $pkg ($pkg_dir)"
      if [ -x "$pkg_dir/node_modules/.bin/node-gyp" ]; then
        ( cd "$pkg_dir" && ./node_modules/.bin/node-gyp rebuild --release ) \
          || { echo "ERROR: $pkg native build failed" >&2; exit 1; }
      else
        local gyp_abs="$PWD/node_modules/.bin/node-gyp"
        if [ ! -x "$gyp_abs" ]; then
          echo "ERROR: cannot find node-gyp for $pkg" >&2
          exit 1
        fi
        ( cd "$pkg_dir" && "$gyp_abs" rebuild --release ) \
          || { echo "ERROR: $pkg native build failed" >&2; exit 1; }
      fi
    }

    rebuild_node_module sqlite3
    rebuild_node_module better-sqlite3 || true

    pnpm --filter @paperclipai/ui build
    pnpm --filter @paperclipai/plugin-sdk build
    pnpm --filter @paperclipai/server build
    pnpm --filter paperclipai build

    test -f server/dist/index.js \
      || (echo "ERROR: server build output missing" >&2; exit 1)
    test -f cli/dist/index.js \
      || (echo "ERROR: cli (paperclipai) build output missing" >&2; exit 1)

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/paperclip
    cp -r --reflink=auto . $out/lib/paperclip/

    mkdir -p $out/bin
    runtimePath=${
      lib.makeBinPath [
        nodejs
        git
        gh
        ripgrep
        openssh
        jq
        python3
        coreutils
        bash
        curl
        wget
      ]
    }

    makeWrapper ${nodejs}/bin/node $out/bin/paperclip \
      --add-flags "--import" \
      --add-flags "$out/lib/paperclip/server/node_modules/tsx/dist/loader.mjs" \
      --add-flags "$out/lib/paperclip/server/dist/index.js" \
      --prefix PATH : "$runtimePath" \
      --set NODE_ENV production

    # paperclipai CLI — bundled by esbuild from the cli workspace.
    # Used for `paperclipai auth bootstrap-ceo`, `doctor`, `env`, etc.
    makeWrapper ${nodejs}/bin/node $out/bin/paperclipai \
      --add-flags "$out/lib/paperclip/cli/dist/index.js" \
      --prefix PATH : "$runtimePath" \
      --set NODE_ENV production

    runHook postInstall
  '';

  doCheck = false;

  # Native prebuilds (sharp, sqlite3, esbuild, rollup) ship as portable
  # .node files; stripping/patchelf'ing them is slow and often breaks them.
  dontStrip = true;
  dontPatchELF = true;

  meta = {
    description = "Open-source control plane for AI-agent companies";
    homepage = "https://github.com/paperclipai/paperclip";
    license = lib.licenses.mit;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
    mainProgram = "paperclip";
  };
})
