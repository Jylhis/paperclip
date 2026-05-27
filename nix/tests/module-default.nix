{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Boots a NixOS VM with the paperclip module in its lightest valid
# configuration: NixOS-managed PostgreSQL via `createLocally = true`,
# no agent CLIs, no memory caps. Also flips on the synthesised nginx
# vhost so we cover the `proxy.nginx` path in the same VM.
let
  testLib = pkgs.callPackage ./lib.nix {
    inherit paperclipModule paperclipPackage;
  };
in
testLib.mkPaperclipTest {
  name = "paperclip-module-default";

  paperclipConfig = {
    deploymentMode = "local_trusted";
    database.createLocally = true;
    listen.mode = "default";
    agentClis.enable = false;
    proxy.nginx = true;
    publicUrl = "http://localhost";
    allowedHostnames = [ "localhost" ];
  };

  testScript = ''
    machine.wait_for_unit("nginx.service")
    machine.wait_for_open_port(80)
    machine.succeed("curl -fsS -H 'Host: localhost' http://127.0.0.1/health")

    # Guard against silent fallback to embedded PG: confirm migrations
    # actually populated the NixOS-managed database.
    table_count = machine.succeed(
        "sudo -u postgres psql -d paperclip -tAc "
        "\"SELECT count(*) FROM information_schema.tables "
        "WHERE table_schema='public' AND table_type='BASE TABLE'\""
    ).strip()
    assert int(table_count) > 0, (
        f"expected paperclip.public to contain migration-created tables, "
        f"got count={table_count!r} — server likely fell back to embedded PG"
    )

    # Peer auth must work end-to-end: as the paperclip OS user we
    # should be able to connect through the Unix socket without any
    # password material.
    machine.succeed(
        "sudo -u paperclip psql -h /run/postgresql paperclip -tAc 'select 1' | grep -q '^1$'"
    )

    # The legacy password-applier oneshot must not exist any more —
    # peer auth replaced the password path entirely.
    machine.fail("systemctl status paperclip-postgres-password.service")

    # Pin the new default-tuned restart policy so a future refactor that
    # silently lowers `startLimitIntervalSec` reintroduces the 60 s window
    # that let the lab loop on lab thrash 8 GB every 30 min.
    unit = machine.succeed("systemctl cat paperclip.service")
    assert "StartLimitIntervalSec=7200" in unit, (
        f"expected StartLimitIntervalSec=7200 in unit, got:\n{unit}"
    )
    assert "RestartSec=120" in unit, (
        f"expected RestartSec=120 in unit, got:\n{unit}"
    )
    # nodeOptions default still lifts V8 above its built-in cap.
    assert "--max-old-space-size=4096" in unit, (
        f"expected NODE_OPTIONS to include --max-old-space-size=4096, got:\n{unit}"
    )
    # Heap snapshots default off — these flags must NOT appear unless
    # heapSnapshots.enable is set.
    assert "--heapsnapshot-signal=SIGUSR2" not in unit, (
        f"heap snapshot flags leaked into default unit:\n{unit}"
    )
  '';
}
