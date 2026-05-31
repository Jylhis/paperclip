{
  lib,
  dockerTools,
  paperclip,
  cacert,
  bash,
  coreutils,
}:
# Lean Nix-built container image for the Paperclip server. Reuses the
# `paperclip` derivation (nix/package.nix) instead of re-installing the
# world inside a Dockerfile, so the image stays in lockstep with the Nix
# build. The `paperclip` wrapper already puts node/git/gh/ripgrep/openssh/
# jq/python3/bash/curl/wget on PATH, so `contents` stays minimal.
#
# Runtime contract mirrors the `production` stage of the root Dockerfile,
# minus the bundled agent CLIs and the gosu-based UID-remap entrypoint:
# this lean image runs directly as a fixed non-root `node` user (uid 1000).
dockerTools.buildLayeredImage {
  name = "paperclip";
  tag = "latest";

  contents = [
    paperclip
    cacert
    bash
    coreutils
    dockerTools.caCertificates
  ];

  config = {
    Cmd = [ (lib.getExe paperclip) ];
    User = "node";
    WorkingDir = "/paperclip";
    ExposedPorts = {
      "3100/tcp" = { };
    };
    Volumes = {
      "/paperclip" = { };
    };
    Env = [
      "NODE_ENV=production"
      "HOME=/paperclip"
      "HOST=0.0.0.0"
      "PORT=3100"
      "SERVE_UI=true"
      "PAPERCLIP_HOME=/paperclip"
      "PAPERCLIP_INSTANCE_ID=default"
      "PAPERCLIP_CONFIG=/paperclip/instances/default/config.json"
      "PAPERCLIP_DEPLOYMENT_MODE=authenticated"
      "PAPERCLIP_DEPLOYMENT_EXPOSURE=private"
      "OPENCODE_ALLOW_ALL_MODELS=true"
      "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
    ];
  };

  # fakeRootCommands runs under fakeroot (no VM/KVM needed) so we can create
  # the non-root `node` user and a writable home, leaving the /paperclip
  # volume owned correctly without a runtime UID-remap entrypoint.
  enableFakechroot = true;
  fakeRootCommands = ''
    ${dockerTools.shadowSetup}
    groupadd -g 1000 node
    useradd -u 1000 -g 1000 -d /paperclip -M -s ${bash}/bin/bash node
    mkdir -p /paperclip
    chown -R node:node /paperclip
  '';
}
