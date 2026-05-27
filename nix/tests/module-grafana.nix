{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Exercises the grafana-cloud telemetry + heap-snapshot paths added
# after the lab OOM incident:
#
#   - `grafanaCloud.selfTelemetry.otlpEndpoint` becomes
#     `OTEL_EXPORTER_OTLP_ENDPOINT` on the unit, with
#     `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`.
#   - `grafanaCloud.selfTelemetry.otlpInstanceId` triggers the
#     `buildOtlpEnvScript` ExecStartPre, which assembles a Basic-auth
#     header at `/run/paperclip/otlp-env` (paperclipExecStart sources
#     it inline before launching the server, so the secret never sits
#     in the unit env).
#   - `heapSnapshots.enable = true` adds the Node diagnostic flags to
#     NODE_OPTIONS and creates `heapSnapshots.dir` via tmpfiles.
#
# Uses `mode = "preStartupOnly"` because the test inspects the
# resolved unit definition and ExecStartPre artefacts only — paperclip
# itself never needs to bind (the OTLP endpoint is unreachable inside
# the VM and waiting for /health would hang).
let
  testLib = pkgs.callPackage ./lib.nix {
    inherit paperclipModule paperclipPackage;
  };
in
testLib.mkPaperclipTest {
  name = "paperclip-module-grafana";
  mode = "preStartupOnly";

  paperclipConfig = {
    deploymentMode = "local_trusted";
    database = {
      createLocally = true;
      passwordFile = "/etc/paperclip-db-pass";
    };
    listen.mode = "default";
    agentClis.enable = false;

    heapSnapshots.enable = true;

    grafanaCloud = {
      enable = true;
      stackSlug = "testlab";
      region = "prod-eu-central-0";
      cloudAccessTokenFile = "/etc/paperclip-gc-cloud-token";
      stackTokenFile = "/etc/paperclip-gc-stack-token";
      selfTelemetry = {
        enable = true;
        # OTLP gateway URL is checked at the unit-env level — we
        # don't need real connectivity in the VM. The OTel SDK
        # retries silently when the endpoint is unreachable.
        otlpEndpoint = "https://otlp-gateway-prod-eu-central-0.grafana.net/otlp";
        otlpInstanceId = "42";
      };
    };
  };

  extraNodeModule =
    _:
    {
      # Stand-in token files the OTLP env builder reads at boot. Real
      # deployments mount these from sops-nix / agenix.
      environment.etc."paperclip-gc-stack-token" = {
        text = "test-stack-token";
        mode = "0440";
        user = "paperclip";
        group = "paperclip";
      };
      environment.etc."paperclip-gc-cloud-token" = {
        text = "test-cloud-token";
        mode = "0440";
        user = "paperclip";
        group = "paperclip";
      };
    };

  testScript = ''
    # ExecStartPre runs before the main process; the runtime env files
    # land in /run/paperclip regardless of whether paperclip itself
    # stays up. Poll for the OTLP file to confirm buildOtlpEnvScript
    # ran (it's the new path under test).
    machine.wait_until_succeeds("test -r /run/paperclip/otlp-env")

    otlp_env = machine.succeed("cat /run/paperclip/otlp-env")
    assert "OTEL_EXPORTER_OTLP_HEADERS=" in otlp_env, (
        f"missing OTEL_EXPORTER_OTLP_HEADERS in /run/paperclip/otlp-env:\n{otlp_env}"
    )
    assert "Authorization=Basic " in otlp_env, (
        f"missing Basic auth header in /run/paperclip/otlp-env:\n{otlp_env}"
    )
    # Decode the base64 payload and verify it's `<instanceId>:<token>`.
    import base64
    b64 = otlp_env.split("Basic ", 1)[1].rstrip("'\n")
    decoded = base64.b64decode(b64).decode()
    assert decoded == "42:test-stack-token", (
        f"OTLP basic-auth payload should be '42:test-stack-token', got {decoded!r}"
    )

    # /run/paperclip/otlp-env must stay owner-only — secrets in here.
    perms = machine.succeed("stat -c '%a %U' /run/paperclip/otlp-env").strip()
    assert perms == "600 paperclip", (
        f"/run/paperclip/otlp-env should be 600 paperclip, got: {perms!r}"
    )

    # Unit env must declare the OTLP endpoint + protocol so the SDK
    # doesn't fall back to localhost:4318.
    unit = machine.succeed("systemctl cat paperclip.service")
    assert 'OTEL_EXPORTER_OTLP_ENDPOINT=' in unit, (
        f"OTEL_EXPORTER_OTLP_ENDPOINT missing from unit env:\n{unit}"
    )
    assert 'OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"' in unit, (
        f"OTEL_EXPORTER_OTLP_PROTOCOL should be http/protobuf:\n{unit}"
    )
    # Heap snapshot flags must be appended to NODE_OPTIONS.
    assert "--heapsnapshot-signal=SIGUSR2" in unit, (
        f"heap snapshot flag missing from NODE_OPTIONS:\n{unit}"
    )
    assert "--diagnostic-dir=/var/lib/paperclip/heapsnaps" in unit, (
        f"diagnostic-dir flag missing from NODE_OPTIONS:\n{unit}"
    )
    # buildOtlpEnvScript must have been wired as an ExecStartPre.
    assert "paperclip-build-otlp-env" in unit, (
        f"buildOtlpEnvScript missing from ExecStartPre:\n{unit}"
    )

    # Heap snapshot directory must exist with the expected ownership
    # and mode (created by systemd.tmpfiles before the unit starts).
    snap_perms = machine.succeed(
        "stat -c '%a %U %G' /var/lib/paperclip/heapsnaps"
    ).strip()
    assert snap_perms == "750 paperclip paperclip", (
        f"heapsnaps dir should be 750 paperclip paperclip, got: {snap_perms!r}"
    )
  '';
}
