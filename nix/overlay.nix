final: prev: {
  paperclip = prev.callPackage ./package.nix { };
  paperclip-agent-clis = prev.callPackage ./agent-clis.nix {
    inherit (prev.stdenv.hostPlatform) system;
  };
  paperclip-mcp-server = prev.callPackage ./mcp-server.nix { };
  paperclipai = prev.callPackage ./paperclipai.nix { };
  paperclip-ui = prev.callPackage ./ui.nix { };
  paperclip-desktop = prev.callPackage ./desktop.nix { };
}
