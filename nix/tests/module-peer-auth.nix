{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Positive end-to-end test for PostgreSQL Unix-socket peer
# authentication on `database.createLocally = true`. The local DB
# path no longer assembles a connection URL from a password file —
# the module exports `PAPERCLIP_DATABASE_SOCKET_DIR` / `_NAME` /
# `_USER` on the unit, the paperclip server resolves a socket-kind
# `DatabaseTarget`, and postgres-js connects via the Unix socket.
# The kernel proves the OS-user identity to Postgres; `pg_hba.conf`'s
# default `local … peer` line maps `paperclip` → role `paperclip`.
#
# Assertions:
#   - PAPERCLIP_DATABASE_SOCKET_DIR / _NAME / _USER all land on the
#     unit's static env block.
#   - `sudo -u paperclip psql -h /run/postgresql paperclip` works —
#     peer auth succeeds for the right OS user.
#   - The drizzle migration ledger has rows — migrations applied
#     end-to-end through the socket connection.
#   - `sudo -u nobody psql -h /run/postgresql paperclip` fails —
#     peer auth rejects the wrong OS user.
#   - No `paperclip-postgres-password.service` exists — the legacy
#     oneshot is gone.
let
  testLib = pkgs.callPackage ./lib.nix {
    inherit paperclipModule paperclipPackage;
  };
in
testLib.mkPaperclipTest {
  name = "paperclip-module-peer-auth";

  paperclipConfig = {
    deploymentMode = "local_trusted";
    database.createLocally = true;
    listen.mode = "default";
    agentClis.enable = false;
  };

  testScript = ''
    env = machine.succeed("systemctl show paperclip.service -p Environment --value")
    for expected in (
        "PAPERCLIP_DATABASE_SOCKET_DIR=/run/postgresql",
        "PAPERCLIP_DATABASE_NAME=paperclip",
        "PAPERCLIP_DATABASE_USER=paperclip",
    ):
        assert expected in env, (
            f"{expected!r} missing from unit env: {env!r}"
        )

    # Peer auth as the matching OS user succeeds.
    machine.succeed(
        "sudo -u paperclip psql -h /run/postgresql paperclip -tAc 'select 1' | grep -q '^1$'"
    )

    # Migrations actually ran against the NixOS-managed database via
    # the socket connection — guards against silent fallback to the
    # embedded Postgres path.
    migrations_count = machine.succeed(
        "sudo -u paperclip psql -h /run/postgresql paperclip -tAc "
        "\"SELECT count(*) FROM __drizzle_migrations\""
    ).strip()
    assert int(migrations_count) > 0, (
        f"expected __drizzle_migrations to contain applied rows, got "
        f"count={migrations_count!r}"
    )

    # Peer auth as the wrong OS user is rejected by `pg_hba.conf`.
    # `sudo -u nobody` proves no password gymnastics can bypass the
    # OS-user identity check on the socket.
    machine.fail(
        "sudo -u nobody psql -h /run/postgresql paperclip -tAc 'select 1'"
    )

    # Legacy password applier must not exist on the peer-auth path.
    machine.fail("systemctl status paperclip-postgres-password.service")
  '';
}
