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
#
# Uses `mode = "preStartupOnly"` because the default-health-check curl in the
# shared preamble would hit 127.0.0.1, but paperclip here only binds the
# tailnet IP.
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

  testLib = pkgs.callPackage ./lib.nix {
    inherit paperclipModule paperclipPackage;
  };
in
testLib.mkPaperclipTest {
  name = "paperclip-module-tailnet";
  mode = "preStartupOnly";

  paperclipConfig = {
    deploymentMode = "local_trusted";
    database.createLocally = true;
    listen = {
      mode = "tailnet";
      tailnetBindHost = shimmedTailnetIp;
    };
    agentClis.enable = false;
  };

  extraNodeModule = _: {
    # Prepend the shim ahead of any real tailscale on the unit's PATH.
    # `systemd.services.<name>.path` is searched left-to-right.
    systemd.services.paperclip.path = pkgs.lib.mkBefore [ tailscaleShim ];
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
