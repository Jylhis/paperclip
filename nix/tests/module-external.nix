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

  testLib = pkgs.callPackage ./lib.nix {
    inherit paperclipModule paperclipPackage;
  };
in
testLib.mkPaperclipTest {
  name = "paperclip-module-external";
  mode = "external";

  paperclipConfig = {
    deploymentMode = "local_trusted";
    database = {
      createLocally = false;
      url = databaseUrl;
      inherit migrationUrl;
    };
    listen.mode = "default";
    agentClis.enable = false;
  };

  extraNodeModule =
    _:
    {
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
    };

  testScript = ''
    # Confirm the unit picked up BOTH connection URLs.
    env = machine.succeed("systemctl show paperclip.service -p Environment --value")
    assert "DATABASE_URL=" in env, f"DATABASE_URL missing from unit env: {env!r}"
    assert "DATABASE_MIGRATION_URL=" in env, (
        f"DATABASE_MIGRATION_URL missing from unit env: {env!r}"
    )

    # Negative-check: the embedded password-applier oneshot should NOT
    # exist in external mode (no NixOS-managed Postgres).
    machine.fail("systemctl status paperclip-postgres-password.service")
  '';
}
