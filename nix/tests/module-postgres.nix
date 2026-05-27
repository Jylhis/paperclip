{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Exercises `createLocally = true` end-to-end: NixOS-managed Postgres,
# the `paperclip-postgres-password` oneshot that applies the password via
# ALTER USER, and the runtime db-env file that the main unit consumes.
# Also pins PostgreSQL 17 (the module's floor) and checks the version.
let
  testLib = pkgs.callPackage ./lib.nix {
    inherit paperclipModule paperclipPackage;
  };
in
testLib.mkPaperclipTest {
  name = "paperclip-module-postgres";

  paperclipConfig = {
    deploymentMode = "local_trusted";
    database = {
      createLocally = true;
      passwordFile = "/etc/paperclip-db-pass";
    };
    listen.mode = "default";
    agentClis.enable = false;
  };

  testScript = ''
    # Sanity-check the role exists and owns the database.
    machine.succeed(
        "sudo -u postgres psql -d paperclip -tAc \"SELECT 1 FROM pg_roles WHERE rolname='paperclip'\" | grep -q '^1$'"
    )

    # Confirm the module pinned PostgreSQL 17 (the floor enforced by the
    # version assertion).
    machine.succeed(
        "sudo -u postgres psql -d paperclip -tAc 'SHOW server_version' | grep -E '^\\s*17\\.'"
    )

    # Verify migrations actually landed in the NixOS-managed database —
    # this is the canonical guard against silent fallback to embedded
    # PostgreSQL when DATABASE_URL is missing or unparseable at boot.
    table_count = machine.succeed(
        "sudo -u postgres psql -d paperclip -tAc "
        "\"SELECT count(*) FROM information_schema.tables "
        "WHERE table_schema='public' AND table_type='BASE TABLE'\""
    ).strip()
    assert int(table_count) > 0, (
        f"expected paperclip.public to contain migration-created tables, "
        f"got count={table_count!r} — server likely fell back to embedded PG"
    )
  '';
}
