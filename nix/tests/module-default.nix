{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Boots a NixOS VM with the paperclip module enabled in its lightest valid
# configuration (embedded DB, no agent CLIs, no memory caps). Also flips on
# the synthesised nginx vhost so we cover the new `proxy.nginx` path in the
# same VM.
pkgs.testers.runNixOSTest {
  name = "paperclip-module-default";

  nodes.machine =
    { ... }:
    {
      imports = [ paperclipModule ];

      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        deploymentMode = "local_trusted";
        database.mode = "embedded";
        bind = "default";
        agentClis.enable = false;
        # MemoryHigh/Max cap below the VM's allotment would block startup.
        memoryHigh = null;
        memoryMax = null;
        proxy.nginx = true;
        publicUrl = "http://localhost";
        allowedHostnames = [ "localhost" ];
      };

      # Tests run inside the VM; firewall would block the proxy hop.
      networking.firewall.enable = false;
    };

  testScript = ''
    machine.wait_for_unit("paperclip.service")
    machine.wait_for_open_port(3100)
    machine.succeed("curl -fsS http://127.0.0.1:3100/health")

    machine.wait_for_unit("nginx.service")
    machine.wait_for_open_port(80)
    machine.succeed("curl -fsS -H 'Host: localhost' http://127.0.0.1/health")
  '';
}
