final: prev: {
  paperclip = prev.callPackage ./package.nix { };
  paperclip-agent-clis = prev.callPackage ./agent-clis.nix {
    inherit (prev.stdenv.hostPlatform) system;
  };
}
