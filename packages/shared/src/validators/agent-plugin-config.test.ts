import { describe, expect, it } from "vitest";
import {
  createAgentPluginConfigSchema,
  pluginEnvSchema,
  serverBinarySchema,
  updateAgentPluginConfigSchema,
} from "./agent-plugin-config.js";
import { isSecretEnvKey, redactPluginEnv } from "../types/agent-plugin-config.js";

describe("serverBinarySchema", () => {
  it("accepts absolute paths", () => {
    expect(serverBinarySchema.parse("/usr/bin/node")).toBe("/usr/bin/node");
    expect(serverBinarySchema.parse("/home/user/.local/bin/mcp-server")).toBe(
      "/home/user/.local/bin/mcp-server",
    );
  });

  it("accepts plain command names", () => {
    expect(serverBinarySchema.parse("node")).toBe("node");
    expect(serverBinarySchema.parse("npx")).toBe("npx");
    expect(serverBinarySchema.parse("mcp-server")).toBe("mcp-server");
  });

  it("rejects .. path traversal", () => {
    expect(serverBinarySchema.safeParse("../../etc/passwd").success).toBe(false);
    expect(serverBinarySchema.safeParse("/usr/../etc/passwd").success).toBe(false);
    expect(serverBinarySchema.safeParse("./..hidden").success).toBe(false);
  });

  it("rejects shell metacharacters", () => {
    expect(serverBinarySchema.safeParse("/bin/sh;rm -rf /").success).toBe(false);
    expect(serverBinarySchema.safeParse("/bin/node|cat /etc/shadow").success).toBe(false);
    expect(serverBinarySchema.safeParse("$(evil)").success).toBe(false);
    expect(serverBinarySchema.safeParse("`evil`").success).toBe(false);
    expect(serverBinarySchema.safeParse("/path/with spaces/node").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(serverBinarySchema.safeParse("").success).toBe(false);
  });

  it("rejects paths over 512 chars", () => {
    expect(serverBinarySchema.safeParse("/bin/" + "a".repeat(510)).success).toBe(false);
  });
});

describe("pluginEnvSchema", () => {
  it("accepts valid env var names", () => {
    const parsed = pluginEnvSchema.parse({ FOO: "bar", MY_VAR_1: "val", _UNDERSCORE: "ok" });
    expect(parsed).toEqual({ FOO: "bar", MY_VAR_1: "val", _UNDERSCORE: "ok" });
  });

  it("rejects invalid env var names", () => {
    expect(pluginEnvSchema.safeParse({ "123INVALID": "v" }).success).toBe(false);
    expect(pluginEnvSchema.safeParse({ "INVALID-NAME": "v" }).success).toBe(false);
    expect(pluginEnvSchema.safeParse({ "INVALID NAME": "v" }).success).toBe(false);
    expect(pluginEnvSchema.safeParse({ "INVALID=NAME": "v" }).success).toBe(false);
  });

  it("rejects values over 4096 chars", () => {
    expect(pluginEnvSchema.safeParse({ LONG: "x".repeat(4097) }).success).toBe(false);
  });

  it("accepts empty env object", () => {
    expect(pluginEnvSchema.parse({})).toEqual({});
  });
});

describe("isSecretEnvKey", () => {
  it("flags secret-like key names", () => {
    expect(isSecretEnvKey("API_TOKEN")).toBe(true);
    expect(isSecretEnvKey("DB_PASSWORD")).toBe(true);
    expect(isSecretEnvKey("GITHUB_SECRET")).toBe(true);
    expect(isSecretEnvKey("MY_KEY")).toBe(true);
    expect(isSecretEnvKey("ACCESS_CREDENTIALS")).toBe(true);
    expect(isSecretEnvKey("PRIVATE_CERT")).toBe(true);
    expect(isSecretEnvKey("AUTH_TOKEN")).toBe(true);
  });

  it("does not flag non-secret keys", () => {
    expect(isSecretEnvKey("NODE_ENV")).toBe(false);
    expect(isSecretEnvKey("PORT")).toBe(false);
    expect(isSecretEnvKey("LOG_LEVEL")).toBe(false);
    expect(isSecretEnvKey("SERVER_HOST")).toBe(false);
  });
});

describe("redactPluginEnv", () => {
  it("redacts secret keys and leaves plain keys unchanged", () => {
    const result = redactPluginEnv({
      NODE_ENV: "production",
      API_TOKEN: "secret-value",
      DB_PASSWORD: "hunter2",
      PORT: "3000",
    });
    expect(result).toEqual({
      NODE_ENV: "production",
      API_TOKEN: "[REDACTED]",
      DB_PASSWORD: "[REDACTED]",
      PORT: "3000",
    });
  });

  it("redacts all values when all keys are secret-like", () => {
    const result = redactPluginEnv({ GITHUB_SECRET: "abc", OPENAI_KEY: "sk-xyz" });
    expect(result).toEqual({ GITHUB_SECRET: "[REDACTED]", OPENAI_KEY: "[REDACTED]" });
  });
});

describe("createAgentPluginConfigSchema", () => {
  const validInput = {
    kind: "mcp" as const,
    name: "my-server",
    serverBinary: "/usr/bin/mcp-server",
  };

  it("parses minimal valid input with defaults", () => {
    const parsed = createAgentPluginConfigSchema.parse(validInput);
    expect(parsed.kind).toBe("mcp");
    expect(parsed.name).toBe("my-server");
    expect(parsed.serverBinary).toBe("/usr/bin/mcp-server");
    expect(parsed.args).toEqual([]);
    expect(parsed.env).toEqual({});
    expect(parsed.timeoutSec).toBe(30);
    expect(parsed.restartPolicy).toBe("on_failure");
    expect(parsed.workspaceScope).toBe("agent");
    expect(parsed.enabled).toBe(true);
  });

  it("accepts lsp kind", () => {
    const parsed = createAgentPluginConfigSchema.parse({ ...validInput, kind: "lsp" });
    expect(parsed.kind).toBe("lsp");
  });

  it("rejects invalid server binary", () => {
    expect(
      createAgentPluginConfigSchema.safeParse({ ...validInput, serverBinary: "../../evil" }).success,
    ).toBe(false);
  });

  it("rejects invalid env key names", () => {
    expect(
      createAgentPluginConfigSchema.safeParse({
        ...validInput,
        env: { "invalid-key": "value" },
      }).success,
    ).toBe(false);
  });

  it("rejects timeoutSec out of range", () => {
    expect(
      createAgentPluginConfigSchema.safeParse({ ...validInput, timeoutSec: 0 }).success,
    ).toBe(false);
    expect(
      createAgentPluginConfigSchema.safeParse({ ...validInput, timeoutSec: 3601 }).success,
    ).toBe(false);
  });

  it("rejects too many args", () => {
    expect(
      createAgentPluginConfigSchema.safeParse({
        ...validInput,
        args: Array.from({ length: 65 }, (_, i) => `arg${i}`),
      }).success,
    ).toBe(false);
  });
});

describe("updateAgentPluginConfigSchema", () => {
  it("allows partial updates", () => {
    const parsed = updateAgentPluginConfigSchema.parse({ enabled: false });
    expect(parsed).toEqual({ enabled: false });
  });

  it("rejects empty update object", () => {
    expect(updateAgentPluginConfigSchema.safeParse({}).success).toBe(false);
  });

  it("validates serverBinary when provided", () => {
    expect(
      updateAgentPluginConfigSchema.safeParse({ serverBinary: "$(evil)" }).success,
    ).toBe(false);
    expect(
      updateAgentPluginConfigSchema.parse({ serverBinary: "/usr/bin/node" }).serverBinary,
    ).toBe("/usr/bin/node");
  });
});
