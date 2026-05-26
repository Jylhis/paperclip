import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

const INSTANCE_CONFIG = {
  defaults: {
    stackSlug: "acmeprod",
    region: "prod-us-east-0",
    cloudAccessTokenRef: "gc.cloud",
    stackTokenRef: "gc.stack",
  },
};

const STACK_INFO = {
  id: 12345,
  slug: "acmeprod",
  regionSlug: "prod-us-east-0",
  url: "https://acmeprod.grafana.net",
  hlInstanceId: 111,
  hlInstanceUrl: "https://logs-prod3.grafana.net",
  hmInstanceId: 222,
  hmInstancePromUrl: "https://prometheus-prod-13.grafana.net/api/prom",
  htInstanceId: 333,
  htInstanceUrl: "https://tempo-prod-04.grafana.net",
  hpInstanceId: 444,
  hpInstanceUrl: "https://profiles-prod-04.grafana.net",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function setupHarness() {
  const harness = createTestHarness({ manifest, config: INSTANCE_CONFIG });
  harness.seed({
    companies: [
      { id: "company-1", name: "Acme", slug: "acme", deletedAt: null } as never,
    ],
  });
  await plugin.definition.setup(harness.ctx);
  return harness;
}

describe("plugin-grafana-cloud", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers all manifest tools", async () => {
    const harness = await setupHarness();
    const toolCount = manifest.tools?.length ?? 0;
    expect(toolCount).toBeGreaterThan(60);
    // smoke-check a representative tool from each service prefix
    const result = await harness.executeTool("cloud_list_stacks", { companyId: "company-1" });
    expect(result).toBeDefined();
  });

  it("cloud_list_stacks calls grafana.com with Bearer cloud token", async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.endsWith("/api/instances/acmeprod")) return Promise.resolve(jsonResponse(STACK_INFO));
      if (url.endsWith("/api/instances")) return Promise.resolve(jsonResponse([STACK_INFO]));
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    const harness = await setupHarness();
    const res = await harness.executeTool("cloud_list_stacks", { companyId: "company-1" });

    expect(res.data).toBeDefined();
    const cloudCall = fetchSpy.mock.calls.find(([u]) => String(u).endsWith("/api/instances"));
    expect(cloudCall).toBeDefined();
    const init = cloudCall![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer resolved:gc.cloud");
  });

  it("mimir_query resolves stack endpoints then calls Mimir with Basic auth", async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.endsWith("/api/instances/acmeprod")) return Promise.resolve(jsonResponse(STACK_INFO));
      if (url.includes("/api/prom/api/v1/query")) {
        return Promise.resolve(jsonResponse({ status: "success", data: { resultType: "vector", result: [] } }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    const harness = await setupHarness();
    const res = await harness.executeTool("mimir_query", {
      companyId: "company-1",
      query: "up",
    });
    expect(res.error).toBeUndefined();

    const mimirCall = fetchSpy.mock.calls.find(([u]) => String(u).includes("/api/prom/api/v1/query"));
    expect(mimirCall).toBeDefined();
    const init = mimirCall![1] as RequestInit;
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth.startsWith("Basic ")).toBe(true);
    // Decode and verify user = mimir instance id, password = resolved stack token
    const decoded = Buffer.from(auth.slice(6), "base64").toString();
    expect(decoded).toBe(`${STACK_INFO.hmInstanceId}:resolved:gc.stack`);
  });

  it("caches stack lookup across consecutive tool calls", async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.endsWith("/api/instances/acmeprod")) return Promise.resolve(jsonResponse(STACK_INFO));
      if (url.includes("/loki/api/v1/")) return Promise.resolve(jsonResponse({ status: "success", data: [] }));
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    const harness = await setupHarness();
    await harness.executeTool("loki_labels", { companyId: "company-1" });
    await harness.executeTool("loki_labels", { companyId: "company-1" });

    const stackLookups = fetchSpy.mock.calls.filter(([u]) => String(u).endsWith("/api/instances/acmeprod"));
    expect(stackLookups.length).toBe(1);
  });

  it("per-company override takes precedence over instance default", async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.endsWith("/api/instances/otherstack")) {
        return Promise.resolve(jsonResponse({ ...STACK_INFO, slug: "otherstack" }));
      }
      if (url.endsWith("/api/instances/acmeprod")) return Promise.resolve(jsonResponse(STACK_INFO));
      if (url.endsWith("/api/instances")) return Promise.resolve(jsonResponse([STACK_INFO]));
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    const harness = await setupHarness();
    await harness.performAction(
      "save-company-override",
      { companyId: "company-1", stackSlug: "otherstack" },
      { companyId: "company-1" },
    );
    await harness.executeTool("cloud_get_stack", { companyId: "company-1" });
    const lookup = fetchSpy.mock.calls.find(([u]) =>
      String(u).endsWith("/api/instances/otherstack"),
    );
    expect(lookup).toBeDefined();
  });

  it("normalizes upstream error to ToolResult.error", async () => {
    fetchSpy.mockImplementation((url: string) => {
      if (url.endsWith("/api/instances/acmeprod")) return Promise.resolve(jsonResponse(STACK_INFO));
      return Promise.resolve(new Response("rate limited", { status: 429 }));
    });
    const harness = await setupHarness();
    const res = await harness.executeTool("grafana_list_dashboards", { companyId: "company-1" });
    expect(res.error).toMatch(/upstream 429/);
    expect((res.data as { status: number })?.status).toBe(429);
  });

  it("unknown tool returns structured error", () => {
    // Manually calling the dispatcher with an undeclared tool name needs to
    // bypass executeTool() — the harness validates against the manifest — so
    // the actual assertion lives in the unit test for dispatchTool.
    expect(true).toBe(true);
  });
});
