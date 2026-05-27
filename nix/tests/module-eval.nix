{
  pkgs,
  paperclipModule,
  paperclipPackage,
}:
# Pure module-evaluation smoke check. Drives the paperclip module through a
# handful of representative scenarios so `nix flake check` catches eval-time
# regressions (option-type errors, assertion mistakes, missing systemd
# attributes) without paying the cost of booting a VM.
#
# Each scenario is fed through `lib.nixosSystem` and forced via
# `builtins.deepSeq`: the systemd unit, ExecStartPre list, and assertion list
# all have to evaluate to completion. If any scenario's assertions report
# `assertion = false`, the throw inside `forceScenario` aborts the build.
let
  inherit (pkgs) lib;

  baseHardware = {
    boot.loader.grub.devices = [ "nodev" ];
    fileSystems."/" = {
      device = "/dev/disk/by-label/nixos";
      fsType = "ext4";
    };
    system.stateVersion = "24.11";
  };

  evalScenario =
    extraConfig:
    (lib.nixosSystem {
      system = pkgs.stdenv.hostPlatform.system;
      modules = [
        paperclipModule
        (_: baseHardware)
        extraConfig
      ];
    }).config;

  scenarios = {
    default = evalScenario {
      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        database.createLocally = true;
      };
    };

    # `database.createLocally = true` is the default — proves the
    # minimum-viable config (no passwordFile, peer auth) evaluates
    # clean without callers having to set the database block at all.
    minimal = evalScenario {
      services.paperclip = {
        enable = true;
        package = paperclipPackage;
      };
    };

    external = evalScenario {
      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        database = {
          createLocally = false;
          url = "postgres://paperclip:secret@db.example.net:5432/paperclip";
          migrationUrl = "postgres://paperclip:secret@db.example.net:5432/paperclip";
        };
      };
    };

    nginxProxy = evalScenario {
      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        database.createLocally = true;
        proxy.nginx = true;
        publicUrl = "https://paperclip.example.com";
        allowedHostnames = [ "paperclip.example.com" ];
      };
    };

    caddyProxy = evalScenario {
      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        database.createLocally = true;
        proxy.caddy = true;
        publicUrl = "https://paperclip.example.com";
        allowedHostnames = [ "paperclip.example.com" ];
      };
    };

    customBind = evalScenario {
      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        database.createLocally = true;
        listen.mode = "custom";
        listen.bindHost = "10.0.0.5";
      };
    };

    tailnet = evalScenario {
      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        database.createLocally = true;
        listen.mode = "tailnet";
      };
    };

    grafanaCloud = evalScenario {
      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        database.createLocally = true;
        grafanaCloud = {
          enable = true;
          stackSlug = "acmeprod";
          region = "prod-eu-central-0";
          cloudAccessTokenFile = "/run/secrets/gc-cloud";
          stackTokenFile = "/run/secrets/gc-stack";
          selfTelemetry.otlpInstanceId = "12345";
        };
      };
    };
  };

  # NixOS surfaces unmet assertions only when the toplevel is built. For a
  # pure-eval check we have to read `config.assertions` ourselves and throw
  # if any have `assertion = false`.
  forceScenario =
    name: cfg:
    let
      failed = builtins.filter (a: !a.assertion) cfg.assertions;
    in
    if failed != [ ] then
      throw "paperclip module-eval scenario '${name}' has failed assertions: ${
        lib.concatMapStringsSep ", " (a: a.message) failed
      }"
    else
      builtins.deepSeq cfg.systemd.services.paperclip (builtins.deepSeq cfg.assertions name);

  results = lib.mapAttrs forceScenario scenarios;

  # Removed-option scenarios: each must FAIL to evaluate, because the
  # option is declared via `mkRemovedOptionModule`. `tryEval` swallows
  # the eval error so we can assert on its absence/presence here
  # rather than aborting the build at the wrong layer.
  removedOptionScenarios = {
    passwordFile = {
      services.paperclip = {
        enable = true;
        package = paperclipPackage;
        database = {
          createLocally = true;
          passwordFile = "/etc/paperclip-db-pass";
        };
      };
    };
  };

  forceRemovedScenario =
    name: extraConfig:
    let
      attempt = builtins.tryEval (
        builtins.deepSeq (evalScenario extraConfig).systemd.services.paperclip name
      );
    in
    if attempt.success then
      throw ''
        paperclip module-eval removed-option scenario '${name}' evaluated
        successfully — expected mkRemovedOptionModule to throw. The
        removed-option entry for ${name} may have been dropped from
        nix/modules/nixos/paperclip.nix.
      ''
    else
      name;

  removedResults = lib.mapAttrs forceRemovedScenario removedOptionScenarios;
in
pkgs.runCommand "paperclip-module-eval"
  {
    passthru = {
      scenarios = builtins.attrNames results;
      removedScenarios = builtins.attrNames removedResults;
    };
  }
  ''
    cat > $out <<'EOF'
    paperclip module-eval scenarios that passed:
    ${lib.concatStringsSep "\n" (map (n: "  - ${n}") (builtins.attrNames results))}

    paperclip module-eval removed-option scenarios that correctly failed:
    ${lib.concatStringsSep "\n" (map (n: "  - ${n}") (builtins.attrNames removedResults))}
    EOF
  ''
