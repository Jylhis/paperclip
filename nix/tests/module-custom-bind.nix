{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Exercises `listen.mode = "custom"` with `bindHost`. The relevant env-var
# plumbing lives at nix/modules/nixos/paperclip.nix:165-166:
#
#   PAPERCLIP_BIND = "custom"
#   PAPERCLIP_BIND_HOST = cfg.listen.bindHost
#
# The assertion at paperclip.nix:1147 also blocks `listen.mode = "custom"`
# without `bindHost`, so this test acts as a regression guard on both the
# happy path and the bind-host plumbing.
#
# We bring a deterministic loopback alias up so paperclip actually has an
# interface to bind to. Without the alias the service would crash at
# startup with EADDRNOTAVAIL.
let
  customBindAddr = "127.0.0.42";

  testLib = pkgs.callPackage ./lib.nix {
    inherit paperclipModule paperclipPackage;
  };
in
testLib.mkPaperclipTest {
  name = "paperclip-module-custom-bind";
  # The default-mode startup health-check curls 127.0.0.1:3100, but paperclip
  # here binds to 127.0.0.42:3100. Use the pre-startup preamble and run our
  # own waits against the bound address.
  mode = "preStartupOnly";

  paperclipConfig = {
    deploymentMode = "local_trusted";
    database.createLocally = true;
    listen.mode = "custom";
    listen.bindHost = customBindAddr;
    agentClis.enable = false;
  };

  extraNodeModule = _: {
    # Without this alias the service crashes at startup with EADDRNOTAVAIL.
    # An ExecStartPre oneshot is cleaner than a NetworkManager rule and
    # works regardless of the VM's network stack.
    systemd.services.paperclip-custom-bind-alias = {
      description = "Add ${customBindAddr}/32 loopback alias for the custom-bind test";
      wantedBy = [ "multi-user.target" ];
      before = [ "paperclip.service" ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        ExecStart = "${pkgs.iproute2}/bin/ip addr add ${customBindAddr}/32 dev lo";
      };
    };
  };

  testScript = ''
    machine.wait_for_unit("paperclip-custom-bind-alias.service")
    machine.wait_for_unit("paperclip.service")
    machine.wait_for_open_port(3100, addr = "${customBindAddr}")
    machine.succeed("curl -fsS http://${customBindAddr}:3100/health")

    # Plumbing assertions: both env vars must land on the unit env block.
    env = machine.succeed("systemctl show paperclip.service -p Environment --value")
    assert "PAPERCLIP_BIND=custom" in env, (
        f"PAPERCLIP_BIND=custom missing from unit env: {env!r}"
    )
    assert "PAPERCLIP_BIND_HOST=${customBindAddr}" in env, (
        f"PAPERCLIP_BIND_HOST=${customBindAddr} missing from unit env: {env!r}"
    )
    # In custom mode the default-mode `HOST` env var must NOT be set —
    # paperclip's server falls back to HOST when PAPERCLIP_BIND is unset,
    # so leaking it back in would silently flip the bind back to 127.0.0.1.
    assert "HOST=" not in env, (
        f"HOST should not appear on the unit env in custom mode: {env!r}"
    )
  '';
}
