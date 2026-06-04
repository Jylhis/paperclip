import { describe, expect, it, vi } from "vitest";
import { fetchGrafanaCloudStackInfo } from "../../observability/stack-info.js";

describe("fetchGrafanaCloudStackInfo", () => {
  it("returns parsed stack info and derives OTLP endpoint from region slug", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        id: 12345,
        slug: "acmeprod",
        regionSlug: "prod-us-east-0",
        url: "https://acmeprod.grafana.net",
        hlInstanceId: 111,
        hlInstanceUrl: "https://logs-prod3.grafana.net",
        hmInstanceId: 222,
        hmInstancePromUrl: "https://prometheus-prod-13-prod-us-east-0.grafana.net/api/prom",
        htInstanceId: 333,
        htInstanceUrl: "https://tempo-prod-04-prod-us-east-0.grafana.net",
      }),
    });
    const info = await fetchGrafanaCloudStackInfo({
      stackSlug: "acmeprod",
      cloudAccessToken: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(info.id).toBe(12345);
    expect(info.otlpEndpoint).toBe("https://otlp-gateway-prod-us-east-0.grafana.net/otlp");
    expect(info.otlpInstanceId).toBe(12345);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://grafana.com/api/instances/acmeprod",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
  });

  it("prefers explicit otlpUrl when grafana.com returns it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        id: 7,
        slug: "x",
        regionSlug: "anything",
        url: "https://x.grafana.net",
        otlpUrl: "https://custom-otlp.example/otlp/",
      }),
    });
    const info = await fetchGrafanaCloudStackInfo({
      stackSlug: "x",
      cloudAccessToken: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(info.otlpEndpoint).toBe("https://custom-otlp.example/otlp");
  });

  it("throws on non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    await expect(
      fetchGrafanaCloudStackInfo({
        stackSlug: "missing",
        cloudAccessToken: "t",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/404/);
  });
});
