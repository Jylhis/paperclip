{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.paperclip;

  inherit (lib)
    mkEnableOption
    mkOption
    mkIf
    mkMerge
    mkRemovedOptionModule
    types
    literalExpression
    optionalAttrs
    optional
    versionAtLeast
    ;

  # postgres-js (porsager/postgres) cannot parse a Unix-socket URL —
  # `?host=` is ignored, and `postgres://user@/db` fails `new URL()`. So
  # for the NixOS-managed local Postgres we go TCP + password and build
  # the full URL at runtime from `passwordFile` (kept out of the store).
  # Extract the hostname from `publicUrl` for the synthesised proxy vhost.
  # Returns null when `publicUrl` is unset (the assertions block proxy.* in
  # that case) or when the URL is malformed (assertion message points at it).
  derivedProxyHost =
    if cfg.publicUrl == null then
      null
    else
      let
        match = builtins.match "https?://([^/:]+)(:[0-9]+)?(/.*)?" cfg.publicUrl;
      in
      if match == null then null else builtins.elemAt match 0;

  proxyHost = if cfg.proxy.virtualHost != null then cfg.proxy.virtualHost else derivedProxyHost;

  proxyEnabled = cfg.proxy.nginx || cfg.proxy.caddy;

  runtimeEnvDir = "/run/paperclip";
  runtimeDbEnvFile = "${runtimeEnvDir}/db-env";
  externalDatabaseUrl = lib.escapeShellArg cfg.database.url;
  externalMigrationUrl =
    if cfg.database.migrationUrl == null then null else lib.escapeShellArg cfg.database.migrationUrl;

  buildDbEnvScript = pkgs.writeShellScript "paperclip-build-db-env" ''
    set -euo pipefail
    umask 077
    ${if cfg.database.createLocally then ''
      pass=$(${pkgs.coreutils}/bin/tr -d '\n' < "${toString cfg.database.passwordFile}")
      # URL-encode the password so special characters don't break the URL.
      encoded=$(${pkgs.coreutils}/bin/printf '%s' "$pass" | ${pkgs.jq}/bin/jq -sRr @uri)
      ${pkgs.coreutils}/bin/printf \
        'DATABASE_URL=postgres://%s:%s@127.0.0.1:5432/%s\n' \
        '${cfg.user}' "$encoded" '${cfg.database.name}' \
        > "${runtimeDbEnvFile}"
    '' else ''
      ${pkgs.coreutils}/bin/printf 'DATABASE_URL=%s\n' ${externalDatabaseUrl} > "${runtimeDbEnvFile}"
      ${if externalMigrationUrl != null then ''
        ${pkgs.coreutils}/bin/printf 'DATABASE_MIGRATION_URL=%s\n' ${externalMigrationUrl} >> "${runtimeDbEnvFile}"
      '' else ""}
    ''}
  '';

  # ExecStart wrapper that sources runtimeDbEnvFile inline before
  # exec'ing the paperclip binary. We do NOT rely on systemd's
  # `EnvironmentFile=` for the runtime db env: the file is created by
  # `ExecStartPre = buildDbEnvScript`, and there are systemd-version
  # combinations where `EnvironmentFile` is parsed before `ExecStartPre`
  # runs. With the file missing at parse time and the `-` prefix
  # silencing the error, the main process would start without
  # DATABASE_URL — at which point the server's runtime falls back to
  # embedded PostgreSQL inside `$PAPERCLIP_HOME`, splitting data away
  # from the NixOS-managed database. Sourcing in the wrapper makes the
  # ordering explicit and immune to that race.
  paperclipExecStart = pkgs.writeShellScript "paperclip-exec-start" ''
    set -euo pipefail
    if [ -r "${runtimeDbEnvFile}" ]; then
      set -a
      # shellcheck disable=SC1091
      . "${runtimeDbEnvFile}"
      set +a
    fi
    exec ${resolvedPackage}/bin/paperclip
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
    PORT = toString cfg.listen.port;
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
  // optionalAttrs (cfg.listen.mode == "default") { HOST = cfg.listen.host; }
  // optionalAttrs (cfg.listen.mode != "default") { PAPERCLIP_BIND = cfg.listen.mode; }
  // optionalAttrs (cfg.listen.mode == "custom") { PAPERCLIP_BIND_HOST = cfg.listen.bindHost; }
  // optionalAttrs (cfg.listen.tailnetBindHost != null) {
    PAPERCLIP_TAILNET_BIND_HOST = cfg.listen.tailnetBindHost;
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
  // optionalAttrs cfg.grafanaCloud.enable (
    {
      # Token files are loaded by the server at runtime — only paths are baked
      # into the unit environment, never the secret material itself. The
      # server's observability bootstrap and the Grafana Cloud plugin both
      # read these env vars.
      GRAFANA_CLOUD_STACK_SLUG = cfg.grafanaCloud.stackSlug;
      GRAFANA_CLOUD_REGION = cfg.grafanaCloud.region;
      GRAFANA_CLOUD_CLOUD_TOKEN_FILE = toString cfg.grafanaCloud.cloudAccessTokenFile;
      GRAFANA_CLOUD_STACK_TOKEN_FILE = toString cfg.grafanaCloud.stackTokenFile;
    }
    // optionalAttrs cfg.grafanaCloud.selfTelemetry.enable {
      GRAFANA_CLOUD_SELF_TELEMETRY_ENABLED = "true";
      OTEL_SERVICE_NAME = cfg.grafanaCloud.selfTelemetry.serviceName;
      OTEL_RESOURCE_ATTRIBUTES =
        "service.namespace=paperclip,deployment.environment=${cfg.grafanaCloud.selfTelemetry.deploymentEnv}";
      OTEL_TRACES_SAMPLER = "parentbased_traceidratio";
      OTEL_TRACES_SAMPLER_ARG = toString cfg.grafanaCloud.selfTelemetry.samplingRatio;
    }
  )
  // cfg.extraEnvironment;
in
{
  # Old options collapsed into `services.paperclip.listen.*` and
  # `services.paperclip.database.{createLocally,url}`. `mkRemovedOptionModule`
  # surfaces a clean eval-time error pointing at the replacement instead of
  # silently dropping the value.
  imports = [
    (mkRemovedOptionModule [ "services" "paperclip" "host" ]
      "Use services.paperclip.listen.host.")
    (mkRemovedOptionModule [ "services" "paperclip" "port" ]
      "Use services.paperclip.listen.port.")
    (mkRemovedOptionModule [ "services" "paperclip" "bind" ]
      "Use services.paperclip.listen.mode.")
    (mkRemovedOptionModule [ "services" "paperclip" "bindHost" ]
      "Use services.paperclip.listen.bindHost.")
    (mkRemovedOptionModule [ "services" "paperclip" "tailnetBindHost" ]
      "Use services.paperclip.listen.tailnetBindHost.")
    (mkRemovedOptionModule [ "services" "paperclip" "database" "mode" ] ''
      services.paperclip.database.mode has been removed. The module now
      supports two database shapes selected by services.paperclip.database.createLocally:

        - createLocally = true  (default): NixOS-managed local PostgreSQL
          via services.postgresql. Replaces mode = "postgresql". Requires
          database.passwordFile.
        - createLocally = false: caller-supplied connection URL. Replaces
          mode = "external". Requires database.url.

      The legacy mode = "embedded" is no longer supported by the NixOS
      module — production deployments must use one of the two shapes
      above. The embedded fallback in the server runtime remains
      available for local development via `pnpm dev`.
    '')
  ];

  options.services.paperclip = {
    enable = mkEnableOption "Paperclip orchestration server";

    # `pkgs.paperclip` is Linux-only. The `or null` keeps option
    # evaluation lazy on darwin so an importer with `enable = false`
    # doesn't trip the missing-attribute error at module-load time.
    # When enabled without a package, the assertion below fires with a
    # human-readable error.
    package = mkOption {
      type = types.nullOr types.package;
      default = pkgs.paperclip or null;
      defaultText = literalExpression "pkgs.paperclip";
      description = ''
        The paperclip package to run. Defaults to `pkgs.paperclip` when
        the overlay is applied. Must be set explicitly on platforms
        without the package (e.g. darwin) or when not using the overlay.
      '';
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

    # All listen-side knobs live in one submodule so callers don't have
    # to thread four mutually-constrained top-level options. The
    # legacy flat names (`host`, `port`, `bind`, `bindHost`,
    # `tailnetBindHost`) have been removed; see the `imports` block above
    # for the migration error pointing at these replacements.
    listen = {
      host = mkOption {
        type = types.str;
        default = "127.0.0.1";
        description = ''
          Address to bind on when `listen.mode = "default"`. For private
          Tailscale access set this to the tailnet IP, or use
          `listen.mode = "tailnet"` and let Paperclip infer it via
          `tailscale ip -4`.
        '';
      };

      port = mkOption {
        type = types.port;
        default = 3100;
        description = "TCP port to listen on.";
      };

      mode = mkOption {
        type = types.enum [
          "default"
          "lan"
          "tailnet"
          "custom"
        ];
        default = "default";
        description = ''
          Bind preset (forwarded as PAPERCLIP_BIND). `default` leaves the
          variable unset so the CLI falls back to its `127.0.0.1`
          default. `tailnet` requires `tailscale` on PATH (the package
          wrapper provides it). `custom` requires `listen.bindHost` and
          emits it as PAPERCLIP_BIND_HOST.
        '';
      };

      bindHost = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "10.0.0.5";
        description = ''
          Address forwarded as PAPERCLIP_BIND_HOST when
          `listen.mode = "custom"`.
        '';
      };

      tailnetBindHost = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "100.101.163.64";
        description = ''
          Hard-pin the tailnet bind host (PAPERCLIP_TAILNET_BIND_HOST)
          when `listen.mode = "tailnet"`. By default paperclip runs
          `tailscale ip -4` at startup to discover its tailnet address;
          setting this skips the lookup. Useful when tailscaled is
          unavailable at boot or you want a deterministic bind.
        '';
      };
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

    proxy = {
      nginx = mkEnableOption ''
        a synthesised nginx virtualHost in front of paperclip. The vhost
        proxies to `host:port`, enables websocket upgrades, and derives
        its server-name from the hostname of `publicUrl`. Requires
        `publicUrl` to be set'';

      caddy = mkEnableOption ''
        a synthesised Caddy virtualHost in front of paperclip. The vhost
        reverse_proxies to `host:port` and derives its server-name from
        the hostname of `publicUrl`. Requires `publicUrl` to be set'';

      enableACME = mkOption {
        type = types.bool;
        default = false;
        description = ''
          Request a TLS certificate via `security.acme` for the hostname
          extracted from `publicUrl`. Only meaningful when `proxy.nginx`
          is enabled (Caddy negotiates ACME on its own when the vhost
          name resolves publicly). Make sure ports 80 and 443 are
          reachable from the ACME challenger when you flip this on.
        '';
      };

      extraConfig = mkOption {
        type = types.lines;
        default = "";
        description = ''
          Extra configuration lines appended into the generated vhost
          block. For nginx this is appended inside `locations."/"`
          (`extraConfig` semantics). For Caddy this is appended after
          the `reverse_proxy` line inside the site block.
        '';
      };

      virtualHost = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "paperclip-internal.corp";
        description = ''
          Override the synthesised vhost server-name. Defaults to the
          hostname extracted from `publicUrl`. Set this when paperclip
          sits behind an internal load balancer whose hostname differs
          from the user-visible `publicUrl` (e.g. user-visible
          `desk.example.com` but the LB hits paperclip via
          `paperclip-internal.corp`). When set, the URL-parse assertion
          on `publicUrl` is skipped — the override defines the vhost
          name directly.
        '';
      };
    };

    database = {
      createLocally = mkOption {
        type = types.bool;
        default = true;
        description = ''
          Selects the database shape:

          - `true` (default): NixOS-managed local PostgreSQL. The module
            enables `services.postgresql`, pins it to PostgreSQL 17,
            provisions the database/role, and applies the password from
            `database.passwordFile` on every boot. Requires
            `database.passwordFile`.
          - `false`: caller-supplied database. The module writes
            `database.url` (and optionally `database.migrationUrl`) to
            `/run/paperclip/db-env`, then sources that file at service
            start as `DATABASE_URL` / `DATABASE_MIGRATION_URL`. Use
            this for hosted databases (e.g. Supabase) or a separately
            managed PostgreSQL.

          Both shapes resolve to the server's internal
          `mode = "postgres"` runtime mode (see
          `packages/db/src/runtime-config.ts`). The legacy embedded
          fallback is not supported by the NixOS module.
        '';
      };

      name = mkOption {
        type = types.str;
        default = "paperclip";
        description = ''
          Database and role name. Only meaningful when
          `createLocally = true` — externally-managed databases encode
          this inside `database.url` instead.
        '';
      };

      url = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "postgres://paperclip:secret@db.internal:5432/paperclip";
        description = ''
          PostgreSQL connection string. Required when
          `createLocally = false`; rejected when `createLocally = true`
          (the URL is built at boot from `passwordFile` instead).

          Exported as `DATABASE_URL` at service start. The
          server's runtime resolver treats this as
          `mode = "postgres"`.
        '';
      };

      migrationUrl = mkOption {
        type = types.nullOr types.str;
        default = null;
        example = "postgres://paperclip:secret@db.internal:5432/paperclip";
        description = ''
          Optional alternate connection string used only for schema
          migrations and plugin namespace migrations. Recommended when
          the runtime `database.url` points at a connection pooler that
          forbids prepared statements (e.g. Supabase Supavisor on port
          6543) — set `migrationUrl` to the direct connection (port
          5432) so migrations and plugin schema work succeed while the
          app continues to use the pooled URL.

          Only valid when `createLocally = false`. Exported as
          `DATABASE_MIGRATION_URL`; see `doc/DATABASE.md` §3 and
          §"Plugin database namespaces" for the upstream contract.
        '';
      };

      passwordFile = mkOption {
        type = types.nullOr types.path;
        default = null;
        example = "/run/secrets/paperclip_db_password";
        description = ''
          Path to a file holding the password for the `name` Postgres
          role. Required when `createLocally = true`. Must be readable
          by the paperclip service user and by the postgres user —
          typically `mode = "0440"`, `owner = "paperclip"`,
          `group = "postgres"`.

          Runtime behaviour worth knowing about:

          - The password is re-applied to the Postgres role on every
            restart via `ALTER USER` (see
            `paperclip-postgres-password.service`). Rotating the file
            and restarting the unit is enough to update the live role —
            no manual `psql` step.
          - The full DATABASE_URL is assembled from this file into
            `/run/paperclip/db-env` by an ExecStartPre and loaded via
            `EnvironmentFile=`. The password is never baked into the
            Nix store.
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

        `deploymentMode = "authenticated"` requires at minimum a
        `BETTER_AUTH_SECRET` entry here (Better Auth refuses to sign
        cookies otherwise). The assertions block does not enforce this
        because the file is loaded by systemd at runtime — eval time
        cannot see what's inside.
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

    grafanaCloud = {
      enable = mkEnableOption ''
        Grafana Cloud integration. When enabled, sets instance defaults for
        the Grafana Cloud plugin (so board users don't have to retype the
        stack and tokens in the UI) and — unless explicitly disabled below —
        ships Paperclip's own metrics, logs, and crash traces to the
        configured stack. Per-company overrides in the plugin UI win over
        these defaults.
      '';

      stackSlug = mkOption {
        type = types.str;
        example = "acmeprod";
        description = ''
          Grafana Cloud stack slug (the subdomain in `<slug>.grafana.net`).
          Used to resolve per-service endpoint URLs via
          `https://grafana.com/api/instances/<slug>`.
        '';
      };

      region = mkOption {
        type = types.str;
        example = "prod-us-east-0";
        description = ''
          Grafana Cloud region the stack lives in. Mostly informational —
          endpoint URLs are looked up at runtime from the stack metadata —
          but exposed as a default for the plugin's per-company override UI.
        '';
      };

      cloudAccessTokenFile = mkOption {
        type = types.path;
        example = "/run/secrets/paperclip-grafana-cloud-access-token";
        description = ''
          Path to a file holding a grafana.com Cloud Access Policy token.
          Used for stack lookup (`grafana.com/api/instances/<slug>`) and for
          plugin Cloud Admin tools. Must be readable by the paperclip
          service user. The file path is exposed via the
          `GRAFANA_CLOUD_CLOUD_TOKEN_FILE` env var; the token contents are
          read at runtime and never baked into the systemd unit definition.
        '';
      };

      stackTokenFile = mkOption {
        type = types.path;
        example = "/run/secrets/paperclip-grafana-cloud-stack-token";
        description = ''
          Path to a file holding a stack-scoped service-account token. Used
          to push OTLP traces/metrics/logs to the stack's OTLP gateway and
          for plugin tools that read stack-scoped resources (dashboards,
          Loki, Tempo, Mimir, OnCall, IRM, etc.). Must be readable by the
          paperclip service user. The file path is exposed via
          `GRAFANA_CLOUD_STACK_TOKEN_FILE`; contents stay out of the env.
        '';
      };

      selfTelemetry = {
        enable = mkOption {
          type = types.bool;
          default = true;
          description = ''
            Ship Paperclip's own OpenTelemetry traces, metrics, and logs to
            the configured Grafana Cloud stack. Always-on once
            `grafanaCloud.enable = true`. Set to `false` to use Grafana
            Cloud only for the plugin's agent-facing tools, with no
            outbound telemetry from the server itself.
          '';
        };

        serviceName = mkOption {
          type = types.str;
          default = "paperclip-server";
          description = ''
            `service.name` resource attribute on emitted spans, metrics,
            and logs. Override to disambiguate multiple Paperclip
            deployments sharing one stack.
          '';
        };

        deploymentEnv = mkOption {
          type = types.str;
          example = "prod";
          default = "prod";
          description = ''
            `deployment.environment` resource attribute (e.g. `prod`,
            `staging`, `dev`). Used in Grafana to filter views per
            environment.
          '';
        };

        samplingRatio = mkOption {
          type = types.float;
          default = 0.1;
          description = ''
            Head-based trace sampling ratio for non-error spans (0..1).
            Errors are always sampled regardless of this value. Lower this
            on high-traffic instances to control cost; raise it for richer
            traces on lightly-loaded deployments.
          '';
        };
      };
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
        Treat the default as a tripwire, not a recommendation. Soft
        cgroup memory limit (`MemoryHigh=` in systemd) — above this the
        kernel aggressively reclaims; the service stays running. The
        bundled V8 heap (NODE_OPTIONS `--max-old-space-size=4096`) plus
        agent subprocesses can blow past 5 GiB on real workloads; raise
        this (or set `null` to leave unset) on hosts where you'd rather
        let the kernel decide.
      '';
    };

    memoryMax = mkOption {
      type = types.nullOr types.str;
      default = "6G";
      example = "3G";
      description = ''
        Treat the default as a tripwire, not a recommendation. Hard
        cgroup memory limit (`MemoryMax=` in systemd) — hitting this
        triggers an in-cgroup OOM kill, after which systemd applies
        `Restart=on-failure`. On hosts with significant headroom raise
        this well above `memoryHigh` (or set `null` to leave unset) so
        a transient spike doesn't restart the unit silently.
      '';
    };
  };

  config = mkIf cfg.enable (mkMerge [
    {
      assertions = [
        {
          assertion = cfg.package != null;
          message = ''
            services.paperclip.package is null — set it explicitly, or
            apply `paperclip.overlays.default` so `pkgs.paperclip`
            resolves. `pkgs.paperclip` is only available on Linux.
          '';
        }
        {
          assertion = cfg.database.createLocally || cfg.database.url != null;
          message = ''
            services.paperclip.database.url is required when
            database.createLocally = false. Provide the connection
            string for the externally-managed PostgreSQL.
          '';
        }
        {
          assertion = !cfg.database.createLocally || cfg.database.passwordFile != null;
          message = ''
            services.paperclip.database.passwordFile is required when
            database.createLocally = true (postgres-js cannot use a
            Unix socket via URL, so we authenticate over TCP with a
            password loaded from this file at boot).
          '';
        }
        {
          assertion = !cfg.database.createLocally || cfg.database.url == null;
          message = ''
            services.paperclip.database.url must be null when
            database.createLocally = true — the URL is assembled at
            boot from `database.passwordFile` and is never baked into
            the Nix store. Switch to createLocally = false if you want
            to supply a complete URL yourself.
          '';
        }
        {
          assertion = cfg.database.migrationUrl == null || !cfg.database.createLocally;
          message = ''
            services.paperclip.database.migrationUrl is only valid
            when database.createLocally = false. It separates the
            migration connection from the runtime URL for hosted
            deployments behind a connection pooler — see
            doc/DATABASE.md §3.
          '';
        }
        {
          assertion =
            cfg.database.url == null
            || builtins.match "postgres(ql)?://.*" cfg.database.url != null;
          message = ''
            services.paperclip.database.url must start with
            `postgres://` or `postgresql://`. Got:
            "${toString cfg.database.url}".
          '';
        }
        {
          assertion =
            cfg.database.migrationUrl == null
            || builtins.match "postgres(ql)?://.*" cfg.database.migrationUrl != null;
          message = ''
            services.paperclip.database.migrationUrl must start with
            `postgres://` or `postgresql://`. Got:
            "${toString cfg.database.migrationUrl}".
          '';
        }
        {
          # Floor at PG 17 — matches the Docker quickstart
          # (postgres:17-alpine), the docs (doc/DATABASE.md §2), and
          # the schema's stated PG 15+ requirement with comfortable
          # headroom. Operators who pin a newer package are fine; this
          # only catches accidental downgrades.
          assertion =
            !cfg.database.createLocally
            || versionAtLeast config.services.postgresql.package.version "17";
          message = ''
            services.paperclip requires PostgreSQL 17 or newer when
            database.createLocally = true. The configured
            services.postgresql.package is version
            "${config.services.postgresql.package.version}". Override
            services.postgresql.package to pkgs.postgresql_17 (or
            newer) or set database.createLocally = false to manage
            PostgreSQL outside this module.
          '';
        }
        {
          assertion =
            cfg.deploymentMode != "authenticated"
            || cfg.listen.mode == "default"
            || cfg.publicUrl != null
            || (cfg.authPublicBaseUrl != null && cfg.allowedHostnames != [ ]);
          message = ''
            services.paperclip: deploymentMode = "authenticated" with a
            non-default `listen.mode` requires either `publicUrl`
            (recommended; upstream derives auth URL + allowlist from it)
            or both `authPublicBaseUrl` and `allowedHostnames` set
            explicitly. See docs.paperclip.ing §Installation Step 5.
          '';
        }
        {
          assertion = cfg.listen.mode != "custom" || cfg.listen.bindHost != null;
          message = ''
            services.paperclip: listen.mode = "custom" requires
            `listen.bindHost`.
          '';
        }
        {
          assertion = !(cfg.proxy.nginx && cfg.proxy.caddy);
          message = ''
            services.paperclip.proxy: enable either `nginx` or `caddy`, not
            both — they would both try to claim ports 80/443.
          '';
        }
        {
          assertion = !proxyEnabled || cfg.publicUrl != null || cfg.proxy.virtualHost != null;
          message = ''
            services.paperclip.proxy.{nginx,caddy} needs a server-name to
            bind. Set `publicUrl` (recommended — also drives the auth
            URL and allowlist) or `proxy.virtualHost` (when the public
            URL's authority is not the vhost name, e.g. behind an
            internal LB).
          '';
        }
        {
          assertion = !proxyEnabled || cfg.publicUrl != null || cfg.deploymentMode != "local_trusted";
          message = ''
            services.paperclip.proxy with deploymentMode = "local_trusted"
            requires `publicUrl`. Virtual-host-only proxy configuration is
            unsafe in local-trusted mode because loopback hostnames can be
            treated as trusted board traffic.
          '';
        }
        {
          # When `virtualHost` is set explicitly we skip the URL parse —
          # the override defines the vhost name. Otherwise the derived
          # hostname must come back non-null.
          assertion = !proxyEnabled || cfg.proxy.virtualHost != null || derivedProxyHost != null;
          message = ''
            services.paperclip.proxy: could not extract a hostname from
            `publicUrl = "${toString cfg.publicUrl}"`. Use a URL of the
            form `https?://<host>[:<port>][/path]`, or set
            `proxy.virtualHost` explicitly.
          '';
        }
        {
          assertion = !cfg.proxy.enableACME || cfg.proxy.nginx;
          message = ''
            services.paperclip.proxy.enableACME is only wired up for the
            nginx vhost. Caddy negotiates ACME itself when the vhost
            name resolves publicly — drop `enableACME` and rely on
            Caddy's default behaviour.
          '';
        }
        {
          assertion =
            !cfg.grafanaCloud.enable
            || (
              cfg.grafanaCloud.stackSlug != ""
              && cfg.grafanaCloud.region != ""
              && cfg.grafanaCloud.cloudAccessTokenFile != null
              && cfg.grafanaCloud.stackTokenFile != null
            );
          message = ''
            services.paperclip.grafanaCloud.enable requires `stackSlug`,
            `region`, `cloudAccessTokenFile`, and `stackTokenFile` to be
            set. The token files are read at runtime by the server and
            must be readable by the paperclip service user.
          '';
        }
        {
          assertion =
            !cfg.grafanaCloud.enable
            || (
              cfg.grafanaCloud.selfTelemetry.samplingRatio >= 0.0
              && cfg.grafanaCloud.selfTelemetry.samplingRatio <= 1.0
            );
          message = ''
            services.paperclip.grafanaCloud.selfTelemetry.samplingRatio
            must be between 0.0 and 1.0 (inclusive).
          '';
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
        allowedTCPPorts = [ cfg.listen.port ];
      };

      systemd.services.paperclip = {
        description = "Paperclip orchestration server";
        wantedBy = [ "multi-user.target" ];
        after = [
          "network-online.target"
        ]
        ++ optional cfg.database.createLocally "postgresql.service"
        # `listen.mode = "tailnet"` makes Paperclip shell out to
        # `tailscale ip -4` at startup; without this ordering it can
        # race the tailscaled login and listen on nothing.
        ++ optional (cfg.listen.mode == "tailnet") "tailscaled-autoconnect.service";
        wants = [
          "network-online.target"
        ]
        ++ optional cfg.database.createLocally "postgresql.service"
        ++ optional (cfg.listen.mode == "tailnet") "tailscaled-autoconnect.service";

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
          # Wrapper sources /run/paperclip/db-env inline before exec'ing
          # paperclip; see `paperclipExecStart` definition for the
          # systemd race rationale.
          ExecStart = "${paperclipExecStart}";
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
        # Build DB env vars into /run/paperclip/db-env; `paperclipExecStart`
        # sources it inline so we are not subject to systemd's
        # EnvironmentFile/ExecStartPre ordering. The script runs as the
        # unit's User so it can write into the RuntimeDirectory without
        # elevated privileges.
        ExecStartPre = [ buildDbEnvScript ];
        // (
          let
            envFiles =
              optional (cfg.environmentFile != null) cfg.environmentFile
              ++ map toString cfg.environmentFiles;
          in
          optionalAttrs (envFiles != [ ]) { EnvironmentFile = envFiles; }
        );
      };
    }

    (mkIf cfg.database.createLocally {
      services.postgresql = {
        enable = true;
        # `mkDefault` so operators can override with a newer (or
        # older — eval-time assertion floors at PG 17) package without
        # tripping a definition-priority conflict.
        package = lib.mkDefault pkgs.postgresql_17;
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

    # Reverse-proxy synthesised in front of paperclip. Both branches assume
    # paperclip itself binds on `listen.host:listen.port` (the default
    # 127.0.0.1) — the proxy then re-exposes the service on 80/443 with
    # the vhost name resolved from `proxy.virtualHost` (when set) or
    # `publicUrl`'s authority.
    (mkIf cfg.proxy.nginx {
      services.nginx = {
        enable = true;
        recommendedProxySettings = true;
      };
      services.nginx.virtualHosts.${proxyHost} = {
        forceSSL = cfg.proxy.enableACME;
        enableACME = cfg.proxy.enableACME;
        locations."/" = {
          proxyPass = "http://${cfg.listen.host}:${toString cfg.listen.port}";
          proxyWebsockets = true;
          extraConfig = cfg.proxy.extraConfig;
        };
      };
    })

    (mkIf cfg.proxy.caddy {
      services.caddy.enable = true;
      services.caddy.virtualHosts.${proxyHost}.extraConfig = ''
        reverse_proxy ${cfg.listen.host}:${toString cfg.listen.port}
        ${cfg.proxy.extraConfig}
      '';
    })
  ]);
}
