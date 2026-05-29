{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Exercises `createLocally = true` end-to-end: NixOS-managed Postgres
# (pinned to PostgreSQL 17, the module's floor), Unix-socket peer
# authentication for the paperclip role, and migration application
# inside the NixOS-managed database. Also asserts the legacy
# `paperclip-postgres-password` oneshot is gone — no password material
# is involved on the local path.
let
  testLib = pkgs.callPackage ./lib.nix {
    inherit paperclipModule paperclipPackage;
  };
in
testLib.mkPaperclipTest {
  name = "paperclip-module-postgres";

  paperclipConfig = {
    deploymentMode = "local_trusted";
    database.createLocally = true;
    listen.mode = "default";
    agentClis.enable = false;
  };

  testScript = ''
    # Sanity-check the role exists and owns the database.
    machine.succeed(
        "sudo -u postgres psql -d paperclip -tAc \"SELECT 1 FROM pg_roles WHERE rolname='paperclip'\" | grep -q '^1$'"
    )

    # Peer auth proves the OS-user → PG-role mapping is intact and
    # `ensureDBOwnership` actually applied (otherwise the connect or
    # the subsequent `\dt` would fail).
    machine.succeed(
        "sudo -u paperclip psql -h /run/postgresql paperclip -tAc 'select 1' | grep -q '^1$'"
    )
    machine.succeed(
        "sudo -u paperclip psql -h /run/postgresql paperclip -tAc "
        "\"SELECT current_user\" | grep -q '^paperclip$'"
    )

    # Confirm the module pinned PostgreSQL 17 (the floor enforced by the
    # version assertion).
    machine.succeed(
        "sudo -u postgres psql -d paperclip -tAc 'SHOW server_version' | grep -E '^\\s*17\\.'"
    )

    # Verify migrations actually landed in the NixOS-managed database —
    # this is the canonical guard against silent fallback to embedded
    # PostgreSQL when the runtime DB config is missing or wrong.
    table_count = machine.succeed(
        "sudo -u postgres psql -d paperclip -tAc "
        "\"SELECT count(*) FROM information_schema.tables "
        "WHERE table_schema='public' AND table_type='BASE TABLE'\""
    ).strip()
    assert int(table_count) > 0, (
        f"expected paperclip.public to contain migration-created tables, "
        f"got count={table_count!r} — server likely fell back to embedded PG"
    )

    # The drizzle migration ledger table must exist and have applied
    # rows, queried through peer auth as the paperclip role. drizzle
    # creates the ledger in the `drizzle` schema, which is not on the
    # role's default search_path (`"$user", public`) — qualify it
    # explicitly so the query resolves the table.
    migrations_count = machine.succeed(
        "sudo -u paperclip psql -h /run/postgresql paperclip -tAc "
        "\"SELECT count(*) FROM drizzle.__drizzle_migrations\""
    ).strip()
    assert int(migrations_count) > 0, (
        f"expected __drizzle_migrations to contain applied rows, got "
        f"count={migrations_count!r}"
    )

    # Negative-check: the password-applier oneshot must not exist
    # any more.
    machine.fail("systemctl status paperclip-postgres-password.service")
  '';
}
