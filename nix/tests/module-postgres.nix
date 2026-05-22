{
  pkgs,
  paperclipModule,
  paperclipOverlay,
}:
# Exercises the postgresql database mode end-to-end: NixOS-managed Postgres,
# the `paperclip-postgres-password` oneshot that applies the password via
# ALTER USER, and the runtime db-env file that the main unit consumes.
pkgs.testers.runNixOSTest {
  name = "paperclip-module-postgres";

  nodes.machine =
    { ... }:
    {
      imports = [ paperclipModule ];
      nixpkgs.overlays = [ paperclipOverlay ];

      # Test-only credential: the module needs a passwordFile readable by
      # both the paperclip user and the postgres user. Real deployments
      # supply this via sops-nix / agenix.
      environment.etc."paperclip-db-pass" = {
        text = "test-password";
        mode = "0440";
        user = "paperclip";
        group = "postgres";
      };

      services.paperclip = {
        enable = true;
        deploymentMode = "local_trusted";
        database = {
          mode = "postgresql";
          createLocally = true;
          passwordFile = "/etc/paperclip-db-pass";
        };
        bind = "default";
        agentClis.enable = false;
        memoryHigh = null;
        memoryMax = null;
      };

      networking.firewall.enable = false;
    };

  testScript = ''
    machine.wait_for_unit("postgresql.service")
    machine.wait_for_unit("paperclip-postgres-password.service")
    machine.wait_for_unit("paperclip.service")
    machine.wait_for_open_port(3100)
    machine.succeed("curl -fsS http://127.0.0.1:3100/health")

    # Sanity-check the role exists and owns the database.
    machine.succeed(
        "sudo -u postgres psql -d paperclip -tAc \"SELECT 1 FROM pg_roles WHERE rolname='paperclip'\" | grep -q '^1$'"
    )
  '';
}
