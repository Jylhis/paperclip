{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Exercises `listen.mode = "tailnet"`. The real `tailscale` binary needs a
# logged-in tailscaled, which isn't available inside a nixosTest VM. Shim it
# with a `writeShellScriptBin` wrapper that prints a deterministic tailnet IP
# (and the matching `--json` flavour Paperclip sometimes queries) so the unit
# can resolve its bind address. Also pin `listen.tailnetBindHost` to the same
# IP so the wrapper's output and Paperclip's chosen bind agree.
let
  shimmedTailnetIp = "100.64.0.5";
  tailscaleShim = pkgs.writeShellScriptBin "tailscale" ''
    case "$1 $2" in
      "ip -4")
        echo "${shimmedTailnetIp}"
        ;;
      "status --json")
        echo '{"Self":{"TailscaleIPs":["${shimmedTailnetIp}"]}}'
        ;;
      *)
        echo "tailscale-shim: unsupported invocation: $*" >&2
        exit 1
        ;;
    esac
  '';
in
pkgs.testers.runNixOSTest {
  name = "paperclip-module-tailnet";

  nodes.machine =
    { ... }:
    {
      imports = [ paperclipModule ];

      # Test-only credential, same shape as module-postgres.nix.
      environment.etc."paperclip-db-pass" = {
        text = "test-password";
        mode = "0440";
        user = "paperclip";
        group = "postgres";
      };

      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        deploymentMode = "local_trusted";
        database = {
          createLocally = true;
          passwordFile = "/etc/paperclip-db-pass";
        };
        listen = {
          mode = "tailnet";
          tailnetBindHost = shimmedTailnetIp;
        };
        agentClis.enable = false;
        memoryHigh = null;
        memoryMax = null;
      };

      # Prepend the shim ahead of any real tailscale on the unit's PATH.
      # `systemd.services.<name>.path` is searched left-to-right.
      systemd.services.paperclip.path = pkgs.lib.mkBefore [ tailscaleShim ];

      networking.firewall.enable = false;
    };

  testScript = ''
    machine.wait_for_unit("paperclip.service")
    machine.wait_for_open_port(3100, addr = "${shimmedTailnetIp}")
    machine.succeed("curl -fsS http://${shimmedTailnetIp}:3100/health")

    # Regression guard: the unit must order itself after
    # tailscaled-autoconnect so paperclip doesn't race tailscaled's login.
    machine.succeed(
        "systemctl show paperclip.service -p After | grep -q tailscaled-autoconnect.service"
    )
  '';
}
