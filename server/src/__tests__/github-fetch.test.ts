import { afterEach, describe, expect, it } from "vitest";
import {
  gitHubApiBase,
  isAllowedGitHubHost,
  resolveRawGitHubUrl,
} from "../services/github-fetch.js";
import { parseGitHubSourceUrl } from "../services/company-portability.js";

const ORIGINAL_ENTERPRISE_HOSTS = process.env.PAPERCLIP_GITHUB_ENTERPRISE_HOSTS;

afterEach(() => {
  if (ORIGINAL_ENTERPRISE_HOSTS === undefined) delete process.env.PAPERCLIP_GITHUB_ENTERPRISE_HOSTS;
  else process.env.PAPERCLIP_GITHUB_ENTERPRISE_HOSTS = ORIGINAL_ENTERPRISE_HOSTS;
});

describe("github fetch URL hardening", () => {
  it("rejects untrusted GitHub Enterprise hostnames by default", () => {
    expect(isAllowedGitHubHost("github.com")).toBe(true);
    expect(isAllowedGitHubHost("127.0.0.1")).toBe(false);
    expect(() => gitHubApiBase("127.0.0.1")).toThrow(/not allowed/i);
    expect(() => parseGitHubSourceUrl("https://127.0.0.1/acme/widgets?ref=main")).toThrow(/not allowed/i);
  });

  it("allows explicitly configured GitHub Enterprise hostnames", () => {
    process.env.PAPERCLIP_GITHUB_ENTERPRISE_HOSTS = "https://ghe.example.test, ghe.internal.test";

    expect(isAllowedGitHubHost("ghe.example.test")).toBe(true);
    expect(gitHubApiBase("ghe.example.test")).toBe("https://ghe.example.test/api/v3");
    expect(
      resolveRawGitHubUrl("ghe.internal.test", "acme", "widgets", "main", "skills/SKILL.md"),
    ).toBe("https://ghe.internal.test/raw/acme/widgets/main/skills/SKILL.md");
  });

  it("rejects dot-segment path traversal before building fetch URLs", () => {
    process.env.PAPERCLIP_GITHUB_ENTERPRISE_HOSTS = "ghe.example.test";

    expect(() => parseGitHubSourceUrl(
      "https://github.com/paperclipai/companies?ref=main&companyPath=../../../../COMPANY.md",
    )).toThrow(/dot-dot/i);
    expect(() => resolveRawGitHubUrl(
      "ghe.example.test",
      "acme",
      "widgets",
      "main",
      "../../../../COMPANY.md",
    )).toThrow(/dot-dot/i);
  });

  it("percent-encodes non-structural path characters in raw fetch URLs", () => {
    expect(
      resolveRawGitHubUrl("github.com", "paperclipai", "company packages", "feature/demo", "My Company/COMPANY.md"),
    ).toBe("https://raw.githubusercontent.com/paperclipai/company%20packages/feature/demo/My%20Company/COMPANY.md");
  });
});
