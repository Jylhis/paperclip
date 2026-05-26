{
  lib,
  fetchPnpmDeps,
  nodejs_22,
  pnpm_9,
}:
# Shared workspace helpers consumed by every Paperclip derivation in this
# directory (package.nix, mcp-server.nix, paperclipai.nix, ui.nix). Centralised
# so the pnpm-lock hash has exactly one source of truth — re-pin instructions
# live in nix/README.md.
let
  version = "0-unstable-2026-05-21";
  pnpm = pnpm_9.override { nodejs = nodejs_22; };

  # Build from the working tree. cleanSource drops .git but not
  # node_modules / dist / data / result; filter those explicitly so the
  # source hash isn't poisoned by build artefacts or local state.
  src = lib.cleanSourceWith {
    name = "paperclip-source";
    src = lib.cleanSource ../.;
    filter =
      path: type:
      let
        base = baseNameOf (toString path);
      in
      !(builtins.elem base [
        "node_modules"
        ".devenv"
        ".direnv"
        "data"
        "dist"
        "result"
        "result-linux"
        ".git"
      ])
      && !(lib.hasPrefix "result-" base);
  };

  # Re-pin whenever `pnpm-lock.yaml` changes:
  #   1. Replace `pnpmDepsHash` below with `lib.fakeHash`.
  #   2. Run `nix build .#paperclip-pnpm-deps --system x86_64-linux`
  #      on a builder with a generous fixupPhase timeout
  #      (nixbuild.net's default 60 s kills the fixup on this tree —
  #      run on the lab or extend the plan).
  #   3. Copy the printed `got:` hash back into `pnpmDepsHash` below.
  pnpmDepsHash = "sha256-+QZzOKLHfEmJiMH3bERs5uulRTYI1xBObd9cHJ5mKB4=";

  pnpmDeps = fetchPnpmDeps {
    pname = "paperclip-pnpm-deps";
    inherit version src;
    inherit pnpm;
    fetcherVersion = 3;
    hash = pnpmDepsHash;
  };
in
{
  inherit
    src
    version
    pnpmDeps
    pnpmDepsHash
    ;
}
