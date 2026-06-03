{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Exercises `createLocally = false` (external mode) end-to-end. A
# sidecar `services.postgresql` runs on the same VM but is *not*
# provisioned by the paperclip module — paperclip connects to it via
# `database.url`, the same way a hosted deployment (e.g. Supabase)
# would. Also sets `database.migrationUrl` distinct from `database.url`
# so the env-file plumbing for that option is exercised.
let
  pgUser = "paperclip";
  pgPassword = "external-test-password";
  pgDatabase = "paperclip";
  pgPort = 5432;

  databaseUrl = "postgres://${pgUser}:${pgPassword}@127.0.0.1:${toString pgPort}/${pgDatabase}";
  # In a real deployment the migration URL would point at a direct
  # connection while `databaseUrl` goes through a pooler. In this VM
  # both point at the same sidecar — the test only verifies the
  # plumbing, not pooler semantics.
  migrationUrl = databaseUrl;
in
pkgs.testers.runNixOSTest {
  name = "paperclip-module-external";

  nodes.machine =
    { ... }:
    {
      imports = [ paperclipModule ];

      # Sidecar PostgreSQL the paperclip module knows nothing about.
      services.postgresql = {
        enable = true;
        package = pkgs.postgresql_17;
        enableTCPIP = true;
        authentication = pkgs.lib.mkOverride 10 ''
          local all all trust
          host  all all 127.0.0.1/32 md5
          host  all all ::1/128      md5
        '';
        ensureDatabases = [ pgDatabase ];
        ensureUsers = [
          {
            name = pgUser;
            ensureDBOwnership = true;
          }
        ];
        initialScript = pkgs.writeText "init-paperclip-pass.sql" ''
          ALTER USER "${pgUser}" WITH PASSWORD '${pgPassword}';
        '';
      };

      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        deploymentMode = "local_trusted";
        database = {
          createLocally = false;
          url = databaseUrl;
          migrationUrl = migrationUrl;
        };
        listen.mode = "default";
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

    # Confirm secrets are NOT leaked through systemd unit Environment.
    env = machine.succeed("systemctl show paperclip.service -p Environment --value")
    assert "DATABASE_URL=" not in env, f"DATABASE_URL leaked into unit env: {env!r}"
    assert "DATABASE_MIGRATION_URL=" not in env, (
        f"DATABASE_MIGRATION_URL leaked into unit env: {env!r}"
    )

    # But both values must still be available at runtime via /run db-env.
    db_env = machine.succeed("cat /run/paperclip/db-env")
    assert "DATABASE_URL=" in db_env, f"DATABASE_URL missing from runtime env file: {db_env!r}"
    assert "DATABASE_MIGRATION_URL=" in db_env, (
        f"DATABASE_MIGRATION_URL missing from runtime env file: {db_env!r}"
    )

    # Negative-check: the embedded password-applier oneshot should NOT
    # exist in external mode (no NixOS-managed Postgres).
    machine.fail("systemctl status paperclip-postgres-password.service")
  '';
}
