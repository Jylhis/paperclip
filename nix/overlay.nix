final: prev:
let
  bundledPlugins = import ./bundled-plugins.nix;
  paperclip = prev.callPackage ./package.nix { };
  bundledPluginPackages = prev.lib.mapAttrs (
    _: relPath:
    prev.runCommand "paperclip-bundled-plugin" { } ''
      ln -s ${paperclip}/lib/paperclip/${relPath} $out
    ''
  ) bundledPlugins.packageRoots;
in
bundledPluginPackages
// {
  inherit paperclip;
  paperclip-agent-clis = prev.callPackage ./agent-clis.nix {
    inherit (prev.stdenv.hostPlatform) system;
  };
  paperclip-mcp-server = prev.callPackage ./mcp-server.nix { };
  paperclipai = prev.callPackage ./paperclipai.nix { };
  paperclip-ui = prev.callPackage ./ui.nix { };
}
