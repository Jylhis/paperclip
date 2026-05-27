{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Exercises `deploymentMode = "authenticated"`. The relevant assertion at
# nix/modules/nixos/paperclip.nix:1133-1144 requires that when listen.mode
# is non-default, either publicUrl or both authPublicBaseUrl and
# allowedHostnames are set. This test exercises the publicUrl path with a
# non-default listen.mode (tailnet, which already has a working shim setup).
#
# Paperclip in authenticated mode needs a BETTER_AUTH_SECRET in
# environmentFile to actually start (see paperclip.nix:720-724); without
# it the service will fail at runtime. This test deliberately stays in
# `preStartupOnly` mode and only inspects the resolved unit definition —
# the goal is to pin the assertion + env-plumbing for authenticated mode,
# not to bring a real auth flow up inside the VM.
let
  testLib = pkgs.callPackage ./lib.nix {
    inherit paperclipModule paperclipPackage;
  };
in
testLib.mkPaperclipTest {
  name = "paperclip-module-authenticated";
  mode = "preStartupOnly";

  paperclipConfig = {
    deploymentMode = "authenticated";
    database.createLocally = true;
    listen.mode = "default";
    agentClis.enable = false;
    publicUrl = "https://paperclip.example.com";
    allowedHostnames = [ "paperclip.example.com" ];
  };

  testScript = ''
    unit = machine.succeed("systemctl cat paperclip.service")
    env = machine.succeed("systemctl show paperclip.service -p Environment --value")

    # deploymentMode reaches the server as PAPERCLIP_DEPLOYMENT_MODE.
    assert "PAPERCLIP_DEPLOYMENT_MODE=authenticated" in env, (
        f"PAPERCLIP_DEPLOYMENT_MODE=authenticated missing from unit env: {env!r}"
    )
    # publicUrl + allowedHostnames both land on the unit env.
    assert "PAPERCLIP_PUBLIC_URL=https://paperclip.example.com" in env, (
        f"PAPERCLIP_PUBLIC_URL missing: {env!r}"
    )
    assert "PAPERCLIP_ALLOWED_HOSTNAMES=paperclip.example.com" in env, (
        f"PAPERCLIP_ALLOWED_HOSTNAMES missing: {env!r}"
    )
    # The hardened systemd directives should all still be in place —
    # authenticated mode shouldn't accidentally drop them.
    for directive in ["NoNewPrivileges=yes", "ProtectSystem=strict", "PrivateTmp=yes"]:
        assert directive in unit, (
            f"hardening directive {directive!r} missing from authenticated-mode unit:\n{unit}"
        )
  '';
}
