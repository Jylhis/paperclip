{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Exercises `proxy.caddy = true`. The module's caddy block at
# nix/modules/nixos/paperclip.nix:1483-1489 configures
# `services.caddy.virtualHosts.<proxyHost>` to reverse-proxy onto
# 127.0.0.1:3100. This test verifies caddy comes up, claims port 80,
# and serves the /health endpoint through the reverse-proxy hop.
let
  testLib = pkgs.callPackage ./lib.nix {
    inherit paperclipModule paperclipPackage;
  };
in
testLib.mkPaperclipTest {
  name = "paperclip-module-caddy";

  paperclipConfig = {
    deploymentMode = "local_trusted";
    database = {
      createLocally = true;
      passwordFile = "/etc/paperclip-db-pass";
    };
    listen.mode = "default";
    agentClis.enable = false;
    proxy.caddy = true;
    publicUrl = "http://localhost";
    allowedHostnames = [ "localhost" ];
  };

  testScript = ''
    machine.wait_for_unit("caddy.service")
    machine.wait_for_open_port(80)
    machine.succeed("curl -fsS -H 'Host: localhost' http://127.0.0.1/health")

    # Sanity: the unit doesn't also pull in nginx (the assertion at
    # paperclip.nix:1154 would have blocked both, but a future regression
    # could land both behind the assertion).
    machine.fail("systemctl status nginx.service")
  '';
}
