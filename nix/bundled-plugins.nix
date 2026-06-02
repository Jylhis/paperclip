{
  workspacePackages = [
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
