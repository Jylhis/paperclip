{
  workspacePackages = [
    "@paperclipai/plugin-authoring-smoke-example"
    "@paperclipai/plugin-file-browser-example"
    "@paperclipai/plugin-hello-world-example"
    "@paperclipai/plugin-kitchen-sink-example"
    "@paperclipai/plugin-orchestration-smoke-example"
    "@paperclipai/plugin-fake-sandbox"
    "@paperclipai/plugin-grafana-cloud"
    "@paperclipai/plugin-llm-wiki"
    "@paperclipai/plugin-workspace-diff"
    "@paperclipai/plugin-cloudflare-sandbox"
    "@paperclipai/plugin-daytona"
    "@paperclipai/plugin-e2b"
    "@paperclipai/plugin-exe-dev"
    "@paperclipai/plugin-modal"
  ];

  packageRoots = {
    paperclip-plugin-authoring-smoke-example = "packages/plugins/examples/plugin-authoring-smoke-example";
    paperclip-plugin-file-browser-example = "packages/plugins/examples/plugin-file-browser-example";
    paperclip-plugin-hello-world-example = "packages/plugins/examples/plugin-hello-world-example";
    paperclip-plugin-kitchen-sink-example = "packages/plugins/examples/plugin-kitchen-sink-example";
    paperclip-plugin-orchestration-smoke-example = "packages/plugins/examples/plugin-orchestration-smoke-example";
    paperclip-plugin-fake-sandbox = "packages/plugins/paperclip-plugin-fake-sandbox";
    paperclip-plugin-grafana-cloud = "packages/plugins/plugin-grafana-cloud";
    paperclip-plugin-llm-wiki = "packages/plugins/plugin-llm-wiki";
    paperclip-plugin-workspace-diff = "packages/plugins/plugin-workspace-diff";
    paperclip-plugin-sandbox-cloudflare = "packages/plugins/sandbox-providers/cloudflare";
    paperclip-plugin-sandbox-daytona = "packages/plugins/sandbox-providers/daytona";
    paperclip-plugin-sandbox-e2b = "packages/plugins/sandbox-providers/e2b";
    paperclip-plugin-sandbox-exe-dev = "packages/plugins/sandbox-providers/exe-dev";
    paperclip-plugin-sandbox-modal = "packages/plugins/sandbox-providers/modal";
  };

  defaultLocalPlugins = [
    "packages/plugins/plugin-llm-wiki"
  ];
}
