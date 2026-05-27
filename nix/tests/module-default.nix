{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Boots a NixOS VM with the paperclip module in its lightest valid
# configuration: NixOS-managed PostgreSQL via `createLocally = true`,
# no agent CLIs, no memory caps. Also flips on the synthesised nginx
# vhost so we cover the `proxy.nginx` path in the same VM.
pkgs.testers.runNixOSTest {
  name = "paperclip-module-default";

  nodes.machine =
    { ... }:
    {
      imports = [ paperclipModule ];

      # Test-only credential: the module needs a passwordFile readable
      # by both the paperclip user and the postgres user. Real
      # deployments supply this via sops-nix / agenix.
      environment.etc."paperclip-db-pass" = {
        text = "test-password";
        mode = "0440";
        user = "paperclip";
        group = "postgres";
      };

      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        deploymentMode = "local_trusted";
        database = {
          createLocally = true;
          passwordFile = "/etc/paperclip-db-pass";
        };
        listen.mode = "default";
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
    machine.wait_for_unit("postgresql.service")
    machine.wait_for_unit("paperclip-postgres-password.service")
    machine.wait_for_unit("paperclip.service")
    machine.wait_for_open_port(3100)
    machine.succeed("curl -fsS http://127.0.0.1:3100/health")

    machine.wait_for_unit("nginx.service")
    machine.wait_for_open_port(80)
    machine.succeed("curl -fsS -H 'Host: localhost' http://127.0.0.1/health")
  '';
}
