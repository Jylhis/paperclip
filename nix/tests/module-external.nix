{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Exercises the external database mode end-to-end: an independently-managed
# Postgres instance, a DATABASE_URL written to a file (with a trailing newline
# to verify the ExecStartPre strip step), and the runtime db-env file that the
# main unit loads via EnvironmentFile.
pkgs.testers.runNixOSTest {
  name = "paperclip-module-external-urlfile";

  nodes.machine =
    { lib, ... }:
    {
      imports = [ paperclipModule ];

      # Postgres running independently — paperclip sees it as "external".
      services.postgresql = {
        enable = true;
        ensureDatabases = [ "paperclip" ];
        ensureUsers = [
          {
            name = "paperclip";
            ensureDBOwnership = true;
          }
        ];
        # Allow the paperclip system user to connect from localhost without a
        # password.  Production deployments use scram-sha-256 + a secret.
        authentication = lib.mkAfter ''
          host paperclip paperclip 127.0.0.1/32 trust
        '';
      };

      # Provide the DATABASE_URL via a file — include a trailing newline to
      # exercise that the ExecStartPre script strips it with tr -d '\r\n'.
      environment.etc."paperclip-db-url" = {
        text = "postgres://paperclip@127.0.0.1:5432/paperclip\n";
        mode = "0440";
        user = "paperclip";
        group = "paperclip";
      };

      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        deploymentMode = "local_trusted";
        database = {
          mode = "external";
          urlFile = "/etc/paperclip-db-url";
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
    machine.wait_for_unit("paperclip.service")
    machine.wait_for_open_port(3100)
    machine.succeed("curl -fsS http://127.0.0.1:3100/health")

    # Confirm the runtime env file was written with the URL and no trailing
    # newline — proves the ExecStartPre strip step works correctly.
    machine.succeed(
        "grep -qxF "
        "'DATABASE_URL=postgres://paperclip@127.0.0.1:5432/paperclip' "
        "/run/paperclip/db-env"
    )
  '';
}
