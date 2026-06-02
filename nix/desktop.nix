{
  lib,
  stdenvNoCC,
  writeShellApplication,
  makeDesktopItem,
  copyDesktopItems,
  chromium,
}:
# Paperclip desktop launcher (Linux). A chromeless browser app-mode window
# pointed at a running Paperclip instance — the server serves the board UI
# same-origin, so this is a dedicated application window, NOT a standalone/
# offline app. Linux only because it ships a GUI launcher + freedesktop entry;
# a macOS counterpart (WKWebView / Electron) can reuse this .desktop + icon +
# URL-config scaffolding.
#
# Engine: `chromium --app=URL` gives a truly chromeless window (no tabs / no
# address bar), persists geometry, and fully supports the web app (service
# worker etc.). The lighter WebKitGTK single-site browser `surf` is marked
# broken in the pinned nixpkgs; `vimb` / `cog` are lighter but show vim-style /
# WPE chrome. Engine is a swappable detail — nothing else in this derivation
# depends on it.
let
  # Keep aligned with nix/lib.nix (single source of truth for the workspace
  # version); this output has no workspace build, so it doesn't import lib.nix.
  version = "0-unstable-2026-05-21";

  # Matches the services.paperclip default listen.host/listen.port
  # (nix/modules/nixos/paperclip.nix), so a local `nix run .#paperclip` and this
  # launcher line up out of the box.
  defaultUrl = "http://127.0.0.1:3100";

  launcher = writeShellApplication {
    name = "paperclip-desktop";
    runtimeInputs = [ chromium ];
    # URL resolution, high→low: CLI arg, $PAPERCLIP_URL, default localhost.
    # A dedicated profile dir keeps the session (login cookies) separate from
    # the user's normal browser and persistent across launches. --class sets the
    # WM_CLASS so the window groups under the Paperclip icon (see startupWMClass).
    text = ''
      url="''${1:-''${PAPERCLIP_URL:-${defaultUrl}}}"
      data_dir="''${XDG_DATA_HOME:-$HOME/.local/share}/paperclip-desktop"
      exec chromium \
        --app="$url" \
        --class=paperclip-desktop \
        --user-data-dir="$data_dir" \
        --no-first-run \
        --no-default-browser-check
    '';
  };
in
stdenvNoCC.mkDerivation {
  pname = "paperclip-desktop";
  inherit version;

  dontUnpack = true;

  nativeBuildInputs = [ copyDesktopItems ];

  desktopItems = [
    (makeDesktopItem {
      name = "paperclip-desktop";
      desktopName = "Paperclip";
      genericName = "AI-agent control plane";
      comment = "Open a Paperclip instance in a dedicated window";
      # %u lets a URL be passed in (e.g. from another app); the wrapper falls
      # back to $PAPERCLIP_URL then the localhost default when none is given.
      exec = "paperclip-desktop %u";
      icon = "paperclip-desktop";
      categories = [
        "Development"
        "Network"
        "ProjectManagement"
      ];
      startupWMClass = "paperclip-desktop";
    })
  ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin
    cp ${launcher}/bin/paperclip-desktop $out/bin/paperclip-desktop

    install -Dm644 ${../ui/public/android-chrome-512x512.png} \
      $out/share/icons/hicolor/512x512/apps/paperclip-desktop.png
    install -Dm644 ${../ui/public/android-chrome-192x192.png} \
      $out/share/icons/hicolor/192x192/apps/paperclip-desktop.png
    install -Dm644 ${../ui/public/favicon.svg} \
      $out/share/icons/hicolor/scalable/apps/paperclip-desktop.svg

    runHook postInstall
  '';

  meta = {
    description = "Paperclip desktop launcher (chromeless window onto a Paperclip instance, Linux)";
    homepage = "https://github.com/paperclipai/paperclip";
    license = lib.licenses.mit;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
    mainProgram = "paperclip-desktop";
  };
}
