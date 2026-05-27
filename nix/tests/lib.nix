{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Shared helper for the paperclip VM tests under nix/tests/. Each test
# previously open-coded:
#
#   - `environment.etc."paperclip-db-pass"` (the passwordFile used by both
#     paperclip and postgres),
#   - `memoryHigh = null; memoryMax = null;` (so the unit's defaults don't
#     blow up the VM's RAM budget),
#   - `networking.firewall.enable = false;` (tests cross the proxy hop on
#     loopback),
#   - the same startup-wait preamble (postgres → password oneshot → paperclip
#     → /health).
#
# `mkPaperclipTest` collapses all of that. Callers supply the
# paperclip-specific config and the per-test assertions; the helper handles
# everything else.
let
  inherit (pkgs) lib;

  startupPreamble = ''
    machine.wait_for_unit("postgresql.service")
    machine.wait_for_unit("paperclip-postgres-password.service")
    machine.wait_for_unit("paperclip.service")
    machine.wait_for_open_port(3100)
    machine.succeed("curl -fsS http://127.0.0.1:3100/health")
  '';

  externalPreamble = ''
    machine.wait_for_unit("postgresql.service")
    machine.wait_for_unit("paperclip.service")
    machine.wait_for_open_port(3100)
    machine.succeed("curl -fsS http://127.0.0.1:3100/health")
  '';

  # For tests that only inspect ExecStartPre artefacts and never need the main
  # process up (e.g. module-grafana.nix, which mocks an unreachable OTLP
  # endpoint). Only block on postgres + the password oneshot.
  preStartupOnlyPreamble = ''
    machine.wait_for_unit("postgresql.service")
    machine.wait_for_unit("paperclip-postgres-password.service")
  '';
in
{
  /*
    Build a paperclip VM test. `paperclipConfig` is merged into
    `services.paperclip` via `lib.mkMerge` so per-test overrides win.
    `extraNodeModule` lets a test inject sibling NixOS config (proxies,
    extra files in /etc, alternate firewall rules) without touching the
    paperclip block.

    Set `mode = "external"` for tests that drive an external DB
    (createLocally = false) — they skip the password-oneshot wait. Set
    `mode = "preStartupOnly"` for tests that intentionally never wait for
    paperclip.service to come up.

    Default `mode = "local"` matches the createLocally = true happy path.
  */
  mkPaperclipTest =
    {
      name,
      paperclipConfig ? { },
      extraNodeModule ? _: { },
      mode ? "local",
      testScript,
    }:
    let
      preamble =
        if mode == "external" then
          externalPreamble
        else if mode == "preStartupOnly" then
          preStartupOnlyPreamble
        else
          startupPreamble;

      # Only apply the postgres-package workaround when the paperclip module
      # owns postgres (createLocally = true). In external mode the test
      # configures its own sidecar postgres and a second pin would conflict.
      createLocally = paperclipConfig.database.createLocally or true;
    in
    pkgs.testers.runNixOSTest {
      inherit name;

      nodes.machine =
        _:
        {
          imports = [
            paperclipModule
            extraNodeModule
          ];

          environment.etc."paperclip-db-pass" = {
            text = "test-password";
            mode = "0440";
            user = "paperclip";
            group = "postgres";
          };

          services.paperclip = lib.mkMerge [
            {
              enable = true;
              package = paperclipPackage;
              # Memory caps below the VM's RAM allotment block startup.
              memoryHigh = null;
              memoryMax = null;
            }
            paperclipConfig
          ];

          # The paperclip module pins `services.postgresql.package = mkDefault
          # postgresql_17`. `pkgs.testers.runNixOSTest`'s driver-configuration
          # also lands a mkDefault on that same option, and two mkDefaults of
          # the same priority conflict on a unique-typed option (even when
          # equal). Pin it here at default priority (100) so paperclip's
          # 17-only assertion still holds without us having to weaken the
          # module's pin globally. Skipped in external mode where the test
          # configures its own sidecar postgres and a second pin would
          # conflict.
          services.postgresql.package = lib.mkIf createLocally pkgs.postgresql_17;

          networking.firewall.enable = false;
        };

      testScript = preamble + "\n" + testScript;
    };

  # Re-export for callers that want to compose extra waits in front of their
  # own assertions without going through `mkPaperclipTest`.
  inherit startupPreamble externalPreamble preStartupOnlyPreamble;
}
