{
  lib,
  stdenv,
  symlinkJoin,
  fetchurl,
  autoPatchelfHook,
  makeWrapper,
  system,
}:
# Each upstream npm package is a thin dispatcher that downloads a
# platform-specific binary at install time. We skip the dispatcher and
# fetch the per-arch tarball directly. To bump:
#   1. Set new version.
#   2. Re-prefetch each per-arch tarball:
#        nix-prefetch-url --type sha256 <tarball-url>
#        nix hash to-sri --type sha256 <hash>
#   3. Confirm binPath inside the tarball hasn't changed.
let
  archInfo = {
    "x86_64-linux" = {
      suffix = "linux-x64";
      dynamicLinked = true;
    };
    "aarch64-linux" = {
      suffix = "linux-arm64";
      dynamicLinked = true;
    };
  };

  info = archInfo.${system} or (throw "paperclip-agent-clis: unsupported system ${system}");

  mkBinary =
    {
      pname,
      version,
      binName,
      binPath,
      hashes,
      urls,
      dynamicLinked ? info.dynamicLinked,
      extraLibs ? [ ],
      preservePayload ? false,
      installCheck ? "",
    }:
    stdenv.mkDerivation {
      inherit pname version;
      src = fetchurl {
        url = urls.${info.suffix};
        hash = hashes.${info.suffix};
      };

      sourceRoot = "package";

      nativeBuildInputs = lib.optional dynamicLinked autoPatchelfHook ++ [ makeWrapper ];
      buildInputs = lib.optionals dynamicLinked (extraLibs ++ [ stdenv.cc.cc.lib ]);
      dontStrip = preservePayload;

      dontConfigure = true;
      dontBuild = true;

      installPhase = ''
        runHook preInstall
        install -Dm755 ${binPath} $out/bin/${binName}
        runHook postInstall
      '';

      doInstallCheck = installCheck != "";
      installCheckPhase = installCheck;

      meta = {
        description = "Agent CLI bundled for Paperclip (${pname}@${version})";
        license = lib.licenses.unfree;
        platforms = builtins.attrNames archInfo;
        mainProgram = binName;
      };
    };

  claude-code = mkBinary {
    pname = "claude-code";
    version = "2.1.144";
    binName = "claude";
    binPath = "claude";
    urls = {
      "linux-x64" =
        "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-x64/-/claude-code-linux-x64-2.1.144.tgz";
      "linux-arm64" =
        "https://registry.npmjs.org/@anthropic-ai/claude-code-linux-arm64/-/claude-code-linux-arm64-2.1.144.tgz";
    };
    hashes = {
      "linux-x64" = "sha256-6679jbV6yZ1hogNyqTs0gS95d1cCWeiPu6GikYw/otI=";
      "linux-arm64" = "sha256-EktgpkRV7kVMDHX07z2ViQJUbskOKYwhUIJLsl38LN8=";
    };
    # Claude Code is a Bun single-file executable. Stripping preserves a valid
    # ELF but drops the appended application payload, leaving raw Bun behavior.
    preservePayload = true;
    installCheck = ''
      runHook preInstallCheck
      version_output="$($out/bin/claude --version 2>&1)"
      case "$version_output" in
        *"2.1.144"*) ;;
        *)
          echo "unexpected claude --version output: $version_output" >&2
          exit 1
          ;;
      esac
      help_output="$($out/bin/claude --help 2>&1)"
      echo "$help_output" | grep -q -- "--print"
      ! echo "$help_output" | grep -q "Bun v"
      runHook postInstallCheck
    '';
  };

  # codex ships as a static-pie ELF; no runtime patching needed.
  codex = mkBinary {
    pname = "codex";
    version = "0.131.0";
    binName = "codex";
    binPath =
      if system == "x86_64-linux" then
        "vendor/x86_64-unknown-linux-musl/codex/codex"
      else
        "vendor/aarch64-unknown-linux-musl/codex/codex";
    dynamicLinked = false;
    urls = {
      "linux-x64" = "https://registry.npmjs.org/@openai/codex/-/codex-0.131.0-linux-x64.tgz";
      "linux-arm64" = "https://registry.npmjs.org/@openai/codex/-/codex-0.131.0-linux-arm64.tgz";
    };
    hashes = {
      "linux-x64" = "sha256-hhPVznf5v7IO4oPv5NsW6n7qbRCauSQVIgF0mDJWET0=";
      "linux-arm64" = "sha256-A1JvTTH2qU08+mnfTXjKyskQCFgRiYPluas7xQABBcA=";
    };
  };

  opencode = mkBinary {
    pname = "opencode";
    version = "1.15.5";
    binName = "opencode";
    binPath = "bin/opencode";
    urls = {
      "linux-x64" = "https://registry.npmjs.org/opencode-linux-x64/-/opencode-linux-x64-1.15.5.tgz";
      "linux-arm64" = "https://registry.npmjs.org/opencode-linux-arm64/-/opencode-linux-arm64-1.15.5.tgz";
    };
    hashes = {
      "linux-x64" = "sha256-taZkHun5OsGO6VQ3ZAnnCDne+bsaRRpfPExtrerNy8Q=";
      "linux-arm64" = "sha256-O2hVGCK+aRHjL87VOKww6yMnzcFFJbMZoarA6vNq+V8=";
    };
  };
in
symlinkJoin {
  name = "paperclip-agent-clis";
  paths = [
    claude-code
    codex
    opencode
  ];

  passthru = { inherit claude-code codex opencode; };

  meta = {
    description = "Bundle of agent CLIs Paperclip can drive (claude-code, codex, opencode)";
    license = lib.licenses.unfree;
    platforms = builtins.attrNames archInfo;
  };
}
