{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.paperclip;

  defaultPackage =
    pkgs.paperclip
      or (throw "services.paperclip: no `paperclip` package found in pkgs; set `services.paperclip.package` or overlay one in.");

  inherit (lib)
    mkEnableOption
    mkOption
    mkIf
    mkMerge
    types
    literalExpression
    optionalAttrs
    optional
    ;

  # postgres-js (porsager/postgres) cannot parse a Unix-socket URL —
  # `?host=` is ignored, and `postgres://user@/db` fails `new URL()`. So
  # for the NixOS-managed local Postgres we go TCP + password and build
  # the full URL at runtime from `passwordFile` (kept out of the store).
  # Eval-time DATABASE_URL is only set for `external` mode where the
  # caller supplies a complete URL.
  evalTimeDatabaseUrl = if cfg.database.mode == "external" then cfg.database.url else null;

  runtimeEnvDir = "/run/paperclip";
  runtimeDbEnvFile = "${runtimeEnvDir}/db-env";

  buildDbEnvScript = pkgs.writeShellScript "paperclip-build-db-env" ''
    set -euo pipefail
    pass=$(${pkgs.coreutils}/bin/tr -d '\n' < "${toString cfg.database.passwordFile}")
    # URL-encode the password so special characters don't break the URL.
    encoded=$(${pkgs.coreutils}/bin/printf '%s' "$pass" | ${pkgs.jq}/bin/jq -sRr @uri)
    umask 077
    ${pkgs.coreutils}/bin/printf \
      'DATABASE_URL=postgres://%s:%s@127.0.0.1:5432/%s\n' \
      '${cfg.user}' "$encoded" '${cfg.database.name}' \
      > "${runtimeDbEnvFile}"
  '';

  agentCliPackage =
    if cfg.agentClis.enable then
      [ (if cfg.agentClis.package != null then cfg.agentClis.package else pkgs.paperclip-agent-clis) ]
    else
      [ ];

  resolvedPackage =
    if cfg.agentClis.enable then
      pkgs.symlinkJoin {
        name = "${cfg.package.name}-with-agent-clis";
        paths = [ cfg.package ] ++ agentCliPackage;
      }
    else
      cfg.package;

  baseEnv = {
    NODE_ENV = "production";
    PORT = toString cfg.port;
    SERVE_UI = if cfg.serveUi then "true" else "false";
    HOME = cfg.stateDir;
    PAPERCLIP_HOME = cfg.stateDir;
    PAPERCLIP_INSTANCE_ID = cfg.instanceId;
    PAPERCLIP_CONFIG = "${cfg.stateDir}/instances/${cfg.instanceId}/config.json";
    PAPERCLIP_DEPLOYMENT_MODE = cfg.deploymentMode;
    PAPERCLIP_DEPLOYMENT_EXPOSURE = cfg.deploymentExposure;
    # Apply pending DB migrations on boot instead of prompting interactively;
    # without these the service hangs on first start against a fresh database.
    PAPERCLIP_MIGRATION_AUTO_APPLY = "true";
    PAPERCLIP_MIGRATION_PROMPT = "never";
    # V8's default old-space cap (~1.7 GB) is too tight for the agent runtime
    # and triggers `Ineffective mark-compacts near heap limit`. Overridable
    # via `extraEnvironment`.
    NODE_OPTIONS = "--max-old-space-size=4096";
    # Upstream Dockerfile sets this so the bundled opencode CLI accepts
    # any model the user configures. Harmless if opencode isn't used.
    OPENCODE_ALLOW_ALL_MODELS = "true";
  }
  # Paperclip's server reads `process.env.HOST` directly and uses it
  # to decide the listen address; setting it conflicts with
  # `PAPERCLIP_BIND`. Only emit HOST when the user has opted into the
  # bind preset called "default" (which means: don't set
  # PAPERCLIP_BIND at all and let the server fall back to HOST or its
  # built-in 127.0.0.1).
  // optionalAttrs (cfg.bind == "default") { HOST = cfg.host; }
  // optionalAttrs (cfg.bind != "default") { PAPERCLIP_BIND = cfg.bind; }
  // optionalAttrs (cfg.bind == "custom") { PAPERCLIP_BIND_HOST = cfg.bindHost; }
  // optionalAttrs (cfg.tailnetBindHost != null) {
    PAPERCLIP_TAILNET_BIND_HOST = cfg.tailnetBindHost;
  }
  // optionalAttrs (cfg.publicUrl != null) { PAPERCLIP_PUBLIC_URL = cfg.publicUrl; }
  // optionalAttrs (cfg.apiUrl != null) { PAPERCLIP_API_URL = cfg.apiUrl; }
  // optionalAttrs (cfg.authPublicBaseUrl != null) {
    PAPERCLIP_AUTH_PUBLIC_BASE_URL = cfg.authPublicBaseUrl;
  }
  // optionalAttrs (cfg.allowedHostnames != [ ]) {
    PAPERCLIP_ALLOWED_HOSTNAMES = lib.concatStringsSep "," cfg.allowedHostnames;
  }
  // optionalAttrs (cfg.secretsMasterKeyFile != null) {
    PAPERCLIP_SECRETS_MASTER_KEY_FILE = toString cfg.secretsMasterKeyFile;
  }
  // optionalAttrs cfg.secretsStrictMode { PAPERCLIP_SECRETS_STRICT_MODE = "true"; }
  # File storage provider — local disk by default, S3 when opted in.
  // optionalAttrs (cfg.storage.localDir != null) {
    PAPERCLIP_STORAGE_LOCAL_DIR = toString cfg.storage.localDir;
  }
  // optionalAttrs cfg.storage.s3.enable (
    {
      PAPERCLIP_STORAGE_PROVIDER = "s3";
      PAPERCLIP_STORAGE_S3_BUCKET = cfg.storage.s3.bucket;
      PAPERCLIP_STORAGE_S3_REGION = cfg.storage.s3.region;
      PAPERCLIP_STORAGE_S3_PREFIX = cfg.storage.s3.prefix;
      PAPERCLIP_STORAGE_S3_FORCE_PATH_STYLE = if cfg.storage.s3.forcePathStyle then "true" else "false";
    }
    // optionalAttrs (cfg.storage.s3.endpoint != null) {
      PAPERCLIP_STORAGE_S3_ENDPOINT = cfg.storage.s3.endpoint;
    }
  )
  // optionalAttrs (evalTimeDatabaseUrl != null) { DATABASE_URL = evalTimeDatabaseUrl; }
  // cfg.extraEnvironment;
in
{
  options.services.paperclip = {
    enable = mkEnableOption "Paperclip orchestration server";

    package = mkOption {
      type = types.package;
      default = defaultPackage;
      defaultText = literalExpression "pkgs.paperclip";
      description = "The paperclip package to run.";
    };

    user = mkOption {
      type = types.str;
      default = "paperclip";
      description = "System user the service runs as.";
    };

    group = mkOption {
      type = types.str;
      default = "paperclip";
      description = "System group the service runs as.";
    };

    stateDir = mkOption {
      type = types.path;
      default = "/var/lib/paperclip";
      description = ''
        Where Paperclip stores its data: instance config, secrets,
        uploaded files, and (in embedded mode) its Postgres data dir.
        Becomes $PAPERCLIP_HOME and $HOME for the service.
      '';
    };

    instanceId = mkOption {
      type = types.str;
      default = "default";
      description = "Paperclip instance id (subdirectory under stateDir).";
    };

    host = mkOption {
      type = types.str;
      default = "127.0.0.1";
      description = ''
        Address to bind on. For private Tailscale access set this to
        the tailnet IP, or use `bind = "tailnet"` and let Paperclip
        infer it via `tailscale ip -4`.
      '';
    };

    port = mkOption {
      type = types.port;
      default = 3100;
      description = "TCP port to listen on.";
    };

    bind = mkOption {
      type = types.enum [
        "default"
        "lan"
        "tailnet"
        "custom"
      ];
      default = "default";
      description = ''
        Bind preset (forwarded as PAPERCLIP_BIND). `default` leaves the
        variable unset so the CLI falls back to its `127.0.0.1` default.
        `tailnet` requires `tailscale` on PATH (the package wrapper
        provides it). `custom` requires `bindHost` and emits it as
        PAPERCLIP_BIND_HOST.
      '';
    };

    bindHost = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "10.0.0.5";
      description = ''
        Address forwarded as PAPERCLIP_BIND_HOST when `bind = "custom"`.
      '';
    };

    deploymentMode = mkOption {
      type = types.enum [
        "local_trusted"
        "authenticated"
      ];
      default = "local_trusted";
      description = ''
        PAPERCLIP_DEPLOYMENT_MODE. In `authenticated` mode the first
        user is created via `sudo -iu paperclip paperclipai auth
        bootstrap-ceo` on the host — the bundled `paperclipai` binary
        is on the unit's PATH, no network or npx required.
        `PAPERCLIP_AGENT_JWT_SECRET` is auto-written to
        `$PAPERCLIP_HOME/instances/<id>/.env` by the initial onboarding
        run — do NOT add it to `environmentFile`.
      '';
    };

    deploymentExposure = mkOption {
      type = types.enum [
        "private"
        "public"
      ];
      default = "private";
      description = "PAPERCLIP_DEPLOYMENT_EXPOSURE.";
    };

    publicUrl = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "https://desk.example.com";
      description = ''
        Canonical external base URL (PAPERCLIP_PUBLIC_URL). When set,
        Paperclip derives the auth public base URL, Better Auth base
        URL, bootstrap-invite URL, and (the URL's host) the hostname
        allowlist from this single value. Upstream recommends this
        over the granular overrides for authenticated deployments.
        Use `allowedHostnames` to add hostnames beyond the public URL.
      '';
    };

    apiUrl = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "https://desk.example.com/api";
      description = ''
        Override the API base URL (PAPERCLIP_API_URL). When the public
        URL goes through a reverse proxy or load balancer on a port
        different from the bind, set this so the server doesn't derive
        a self-URL from its loopback listener. Also injected into
        agent processes as PAPERCLIP_API_URL.
      '';
    };

    tailnetBindHost = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "100.101.163.64";
      description = ''
        Hard-pin the tailnet bind host (PAPERCLIP_TAILNET_BIND_HOST)
        when `bind = "tailnet"`. By default paperclip runs
        `tailscale ip -4` at startup to discover its tailnet address;
        setting this skips the lookup. Useful when tailscaled is
        unavailable at boot or you want a deterministic bind.
      '';
    };

    authPublicBaseUrl = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "https://desk.example.com";
      description = ''
        Granular override for the auth base URL
        (PAPERCLIP_AUTH_PUBLIC_BASE_URL). Prefer `publicUrl` for new
        deployments — that single value derives this and several
        other URLs. Kept for callers that need to point auth at a
        different host than the public URL.
      '';
    };

    secretsMasterKeyFile = mkOption {
      type = types.nullOr types.path;
      default = null;
      example = "/run/secrets/paperclip_secrets_master_key";
      description = ''
        Path to a file holding the master key used to encrypt at
        rest the provider credentials users save via the UI
        (PAPERCLIP_SECRETS_MASTER_KEY_FILE). SOPS-manage this and
        back it up alongside `stateDir` — losing it loses every
        saved provider key. If unset, Paperclip generates a key
        on first boot under `$PAPERCLIP_HOME/instances/<id>/`, which
        is fine but ties the keys' fate to that directory.
      '';
    };

    secretsStrictMode = mkOption {
      type = types.bool;
      default = false;
      description = ''
        PAPERCLIP_SECRETS_STRICT_MODE. When true, requires secret refs
        for sensitive env vars instead of inline values — protects
        against accidental commits of plaintext credentials at the
        cost of stricter UI handling.
      '';
    };

    storage = {
      localDir = mkOption {
        type = types.nullOr types.path;
        default = null;
        example = "/var/lib/paperclip/storage";
        description = ''
          PAPERCLIP_STORAGE_LOCAL_DIR. Override the local-disk file
          storage location. Ignored when `storage.s3.enable = true`.
        '';
      };

      s3 = {
        enable = mkEnableOption "S3-backed file storage (PAPERCLIP_STORAGE_PROVIDER=s3)";

        bucket = mkOption {
          type = types.str;
          default = "paperclip";
          description = "PAPERCLIP_STORAGE_S3_BUCKET.";
        };

        region = mkOption {
          type = types.str;
          default = "us-east-1";
          description = "PAPERCLIP_STORAGE_S3_REGION.";
        };

        endpoint = mkOption {
          type = types.nullOr types.str;
          default = null;
          example = "https://minio.example.com";
          description = ''
            PAPERCLIP_STORAGE_S3_ENDPOINT. Set for S3-compatible
            services (MinIO, R2, etc.).
          '';
        };

        prefix = mkOption {
          type = types.str;
          default = "";
          description = "PAPERCLIP_STORAGE_S3_PREFIX — key prefix.";
        };

        forcePathStyle = mkOption {
          type = types.bool;
          default = false;
          description = ''
            PAPERCLIP_STORAGE_S3_FORCE_PATH_STYLE. Use path-style URLs
            (required by MinIO and some other S3-compatibles).
          '';
        };
      };
    };

    hardenSyscalls = mkOption {
      type = types.bool;
      default = true;
      description = ''
        Apply a `SystemCallFilter` restricting the unit to
        `@system-service` minus `@privileged` and `@resources`.
        Disable if a bundled agent CLI ever needs a syscall outside
        that set (e.g. a debugger or container runtime).
      '';
    };

    allowedHostnames = mkOption {
      type = types.listOf types.str;
      default = [ ];
      example = literalExpression ''[ "desk.example.com" "www.desk.example.com" ]'';
      description = ''
        Hostnames Paperclip will accept requests for, emitted as a
        comma-separated PAPERCLIP_ALLOWED_HOSTNAMES. Requests for
        unlisted hosts are rejected in authenticated mode.
      '';
    };

    serveUi = mkOption {
      type = types.bool;
      default = true;
      description = "Serve the React UI from the same process (SERVE_UI=true).";
    };

    agentClis = {
      enable = mkEnableOption "bundled agent CLIs (claude-code, codex, opencode)";
      package = mkOption {
        type = types.nullOr types.package;
        default = null;
        defaultText = literalExpression "pkgs.paperclip-agent-clis";
        description = "Override the agent CLI bundle (defaults to pkgs.paperclip-agent-clis).";
      };
    };

    database = {
      mode = mkOption {
        type = types.enum [
          "postgresql"
          "embedded"
          "external"
        ];
        default = "postgresql";
        description = ''
          - `postgresql`: NixOS-managed local Postgres, peer auth via
            Unix socket. Recommended for server deployments.
          - `embedded`: server runs its own bundled Postgres. Good for
            single-user / development.
          - `external`: provide DATABASE_URL via `database.url`.
        '';
      };

      name = mkOption {
        type = types.str;
        default = "paperclip";
        description = "Database/role name (postgresql mode).";
      };

      createLocally = mkOption {
        type = types.bool;
        default = true;
        description = ''
          When `mode = "postgresql"`, also enable and provision
          services.postgresql here. Set false if you manage Postgres
          via a separate NixOS module.
        '';
      };

      url = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "postgres://paperclip:secret@db.internal:5432/paperclip";
        description = "Connection string used when `mode = \"external\"`.";
      };

      passwordFile = mkOption {
        type = types.nullOr types.path;
        default = null;
        example = "/run/secrets/paperclip_db_password";
        description = ''
          Path to a file holding the password for the `name` Postgres
          role. Required when `mode = "postgresql"`. The password is
          applied at boot via `ALTER USER` and assembled into
          DATABASE_URL at runtime by an ExecStartPre — never baked
          into the Nix store. Must be readable by the paperclip
          service user, and (when `createLocally = true`) by the
          postgres user too — typically `mode = "0440"`,
          `owner = "paperclip"`, `group = "postgres"`.
        '';
      };
    };

    environmentFile = mkOption {
      type = types.nullOr types.path;
      default = null;
      example = "/run/secrets/paperclip.env";
      description = ''
        Path to an env file passed to systemd via `EnvironmentFile=`.
        Use this for secrets like `BETTER_AUTH_SECRET`, `OPENAI_API_KEY`,
        `ANTHROPIC_API_KEY`. Must be readable by the service user.
      '';
    };

    environmentFiles = mkOption {
      type = types.listOf types.path;
      default = [ ];
      example = literalExpression ''[ "/run/secrets/paperclip-extra.env" ]'';
      description = ''
        Additional env files layered on top of `environmentFile` (each
        forwarded as a `EnvironmentFile=` entry). Use this when secrets
        come from multiple sources (e.g. a base file plus a host-specific
        overlay) — paths later in the list win on key collisions.
      '';
    };

    extraEnvironment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      example = literalExpression ''{ PAPERCLIP_STORAGE_MODE = "s3"; }'';
      description = "Additional environment variables for the unit.";
    };

    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = ''
        Open the listening port in `networking.firewall`. Leave false
        for tailnet-only deployments (Tailscale carries its own ACLs).
      '';
    };

    memoryHigh = mkOption {
      type = types.nullOr types.str;
      default = "5G";
      example = "2G";
      description = ''
        Soft cgroup memory limit (`MemoryHigh=` in systemd). Above this
        the kernel aggressively reclaims; the service stays running.
        Set to `null` to leave unset (useful on small hosts).
      '';
    };

    memoryMax = mkOption {
      type = types.nullOr types.str;
      default = "6G";
      example = "3G";
      description = ''
        Hard cgroup memory limit (`MemoryMax=` in systemd). Hitting
        this triggers an in-cgroup OOM kill, after which systemd
        applies `Restart=on-failure`. Set to `null` to leave unset.
      '';
    };
  };

  config = mkIf cfg.enable (mkMerge [
    {
      assertions = [
        {
          assertion = cfg.database.mode != "external" || cfg.database.url != null;
          message = "services.paperclip.database.mode = \"external\" requires database.url.";
        }
        {
          assertion = cfg.database.mode != "postgresql" || cfg.database.passwordFile != null;
          message = ''
            services.paperclip.database.mode = "postgresql" requires
            `database.passwordFile` (postgres-js cannot use a Unix
            socket via URL, so we authenticate over TCP with a
            password loaded from this file at boot).
          '';
        }
        {
          assertion =
            cfg.deploymentMode != "authenticated"
            || cfg.bind == "default"
            || cfg.publicUrl != null
            || (cfg.authPublicBaseUrl != null && cfg.allowedHostnames != [ ]);
          message = ''
            services.paperclip: deploymentMode = "authenticated" with a
            non-default `bind` requires either `publicUrl` (recommended;
            upstream derives auth URL + allowlist from it) or both
            `authPublicBaseUrl` and `allowedHostnames` set explicitly.
            See docs.paperclip.ing §Installation Step 5.
          '';
        }
        {
          assertion = cfg.bind != "custom" || cfg.bindHost != null;
          message = "services.paperclip: bind = \"custom\" requires `bindHost`.";
        }
      ];

      # Put `paperclip`, `paperclipai`, and (when enabled) the bundled
      # agent CLIs on the system PATH so interactive sessions
      # (`sudo -iu paperclip paperclipai auth bootstrap-ceo`) work
      # without npx. Also picked up by the unit's PATH below since
      # `systemd.services.paperclip.path = environment.systemPackages`.
      environment.systemPackages = [ resolvedPackage ];

      users.users.${cfg.user} = {
        isSystemUser = true;
        inherit (cfg) group;
        home = cfg.stateDir;
        createHome = false;
        # Real shell so `sudo -iu paperclip` can be used to run
        # `paperclipai auth bootstrap-ceo` and similar on the host.
        shell = pkgs.bashInteractive;
        description = "Paperclip orchestration server";
      };
      users.groups.${cfg.group} = { };

      systemd.tmpfiles.rules = [
        "d ${cfg.stateDir} 0750 ${cfg.user} ${cfg.group} -"
        "d ${cfg.stateDir}/instances 0750 ${cfg.user} ${cfg.group} -"
      ];

      networking.firewall = mkIf cfg.openFirewall {
        allowedTCPPorts = [ cfg.port ];
      };

      systemd.services.paperclip = {
        description = "Paperclip orchestration server";
        wantedBy = [ "multi-user.target" ];
        after = [
          "network-online.target"
        ]
        ++ optional (cfg.database.mode == "postgresql" && cfg.database.createLocally) "postgresql.service"
        # `bind = "tailnet"` makes Paperclip shell out to `tailscale ip -4`
        # at startup; without this ordering it can race the tailscaled
        # login and listen on nothing.
        ++ optional (cfg.bind == "tailnet") "tailscaled-autoconnect.service";
        wants = [
          "network-online.target"
        ]
        ++ optional (cfg.database.mode == "postgresql" && cfg.database.createLocally) "postgresql.service"
        ++ optional (cfg.bind == "tailnet") "tailscaled-autoconnect.service";

        environment = baseEnv;

        # Explicit runtime PATH for agent subprocesses. Mirrors the
        # package wrapper's `--prefix PATH` (packages/paperclip/default.nix)
        # plus `resolvedPackage` so paperclipai and the bundled agent
        # CLIs (claude/codex/opencode) resolve from the unit's PATH.
        # Narrower than `environment.systemPackages` on purpose: that
        # leaked unrelated host tools into the sandboxed unit.
        path = [
          resolvedPackage
        ]
        ++ (with pkgs; [
          git
          gh
          ripgrep
          openssh
          jq
          coreutils
          bash
          curl
          wget
          tailscale
        ]);

        unitConfig = {
          StartLimitBurst = 5;
          StartLimitIntervalSec = 60;
        };

        serviceConfig = {
          Type = "simple";
          User = cfg.user;
          Group = cfg.group;
          WorkingDirectory = "${resolvedPackage}/lib/paperclip";
          ExecStart = "${resolvedPackage}/bin/paperclip";
          Restart = "on-failure";
          RestartSec = 5;
          # /run/paperclip — used to hold the runtime-built db-env file.
          RuntimeDirectory = "paperclip";
          RuntimeDirectoryMode = "0750";

          # Hardening — keep the service confined to its state dir.
          ProtectSystem = "strict";
          # tmpfs (not `true`) so `cfg.stateDir` can sit under /home if a
          # consumer ever moves it there; BindPaths re-exposes only the
          # state dir.
          ProtectHome = "tmpfs";
          BindPaths = [ cfg.stateDir ];
          PrivateTmp = true;
          PrivateDevices = true;
          NoNewPrivileges = true;
          ReadWritePaths = [ cfg.stateDir ];
          RestrictAddressFamilies = [
            "AF_UNIX"
            "AF_INET"
            "AF_INET6"
          ];
          RestrictNamespaces = true;
          RestrictRealtime = true;
          RestrictSUIDSGID = true;
          LockPersonality = true;
          ProtectKernelTunables = true;
          ProtectKernelModules = true;
          ProtectKernelLogs = true;
          ProtectControlGroups = true;
          ProtectClock = true;
          ProtectHostname = true;
          ProtectProc = "invisible";
          ProcSubset = "pid";
          RemoveIPC = true;
          UMask = "0077";
          # Service binds port 3100 (>1024) and needs no capabilities.
          CapabilityBoundingSet = "";
          AmbientCapabilities = "";
          SystemCallArchitectures = "native";
          # MemoryDenyWriteExecute stays off — V8's JIT needs WX pages.
        }
        // optionalAttrs cfg.hardenSyscalls {
          SystemCallFilter = [
            "@system-service"
            "~@privileged"
            "~@resources"
          ];
          SystemCallErrorNumber = "EPERM";
        }
        # Cap RSS so a runaway agent context can't take the host down,
        # and so the V8 heap limit (NODE_OPTIONS above) gets a clean
        # restart from systemd instead of a silent kernel OOM-kill.
        // optionalAttrs (cfg.memoryHigh != null) { MemoryHigh = cfg.memoryHigh; }
        // optionalAttrs (cfg.memoryMax != null) { MemoryMax = cfg.memoryMax; }
        // optionalAttrs (cfg.database.mode == "postgresql") {
          # Build DATABASE_URL from `passwordFile` into a runtime env
          # file, then load it via EnvironmentFile below. The script
          # runs as the unit's User so it can write into the
          # RuntimeDirectory without elevated privileges.
          ExecStartPre = [ buildDbEnvScript ];
        }
        // (
          let
            envFiles =
              optional (cfg.environmentFile != null) cfg.environmentFile
              ++ map toString cfg.environmentFiles
              ++ optional (cfg.database.mode == "postgresql") "-${runtimeDbEnvFile}";
          in
          optionalAttrs (envFiles != [ ]) { EnvironmentFile = envFiles; }
        );
      };
    }

    (mkIf (cfg.database.mode == "postgresql" && cfg.database.createLocally) {
      services.postgresql = {
        enable = true;
        ensureDatabases = [ cfg.database.name ];
        ensureUsers = [
          {
            name = cfg.user;
            ensureDBOwnership = true;
          }
        ];
      };

      # NixOS `ensureUsers` does not set a password. Apply the one
      # from `passwordFile` after postgres is up and before the
      # paperclip service tries to connect.
      systemd.services."paperclip-postgres-password" = {
        description = "Set Postgres password for the paperclip role";
        after = [
          "postgresql.service"
          "postgresql-setup.service"
        ];
        requires = [
          "postgresql.service"
          "postgresql-setup.service"
        ];
        wantedBy = [ "multi-user.target" ];
        # Re-run on rekey of the password file.
        restartTriggers = [ (toString cfg.database.passwordFile) ];
        serviceConfig = {
          Type = "oneshot";
          User = "postgres";
          Group = "postgres";
          RemainAfterExit = true;
          ExecStart = pkgs.writeShellScript "paperclip-postgres-password" ''
            set -euo pipefail
            for _ in $(${pkgs.coreutils}/bin/seq 1 30); do
              ${config.services.postgresql.package}/bin/pg_isready -q && break
              ${pkgs.coreutils}/bin/sleep 1
            done
            pass=$(${pkgs.coreutils}/bin/tr -d '\n' < "${toString cfg.database.passwordFile}")
            # Double any single quotes so the SQL literal is safe.
            escaped=$(${pkgs.coreutils}/bin/printf '%s' "$pass" \
              | ${pkgs.gnused}/bin/sed "s/'/'''/g")
            ${config.services.postgresql.package}/bin/psql -d ${cfg.database.name} \
              -c "ALTER USER ${cfg.user} WITH PASSWORD '$escaped';"
          '';
        };
      };

      systemd.services.paperclip = {
        after = [ "paperclip-postgres-password.service" ];
        requires = [ "paperclip-postgres-password.service" ];
        # Rebuild `/run/paperclip/db-env` on rekey so the running unit
        # reconnects with the new password instead of failing on the
        # next reconnect. The password-applier already restarts on
        # rekey via its own restartTriggers above.
        restartTriggers = [ (toString cfg.database.passwordFile) ];
      };
    })
  ]);
}
