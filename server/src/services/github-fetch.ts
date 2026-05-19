import { unprocessable } from "../errors.js";

const GITHUB_ENTERPRISE_HOSTS_ENV = "PAPERCLIP_GITHUB_ENTERPRISE_HOSTS";

export function isGitHubDotCom(hostname: string) {
  const h = normalizeGitHubHostname(hostname);
  return h === "github.com" || h === "www.github.com";
}

function normalizeGitHubHostname(hostname: string) {
  return hostname.trim().replace(/\.$/, "").toLowerCase();
}

function configuredEnterpriseHosts() {
  return new Set(
    (process.env[GITHUB_ENTERPRISE_HOSTS_ENV] ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        try {
          return normalizeGitHubHostname(new URL(entry).hostname);
        } catch {
          return normalizeGitHubHostname(entry);
        }
      })
      .filter(Boolean),
  );
}

export function isAllowedGitHubHost(hostname: string) {
  const h = normalizeGitHubHostname(hostname);
  return isGitHubDotCom(h) || configuredEnterpriseHosts().has(h);
}

export function assertAllowedGitHubHost(hostname: string) {
  if (!isAllowedGitHubHost(hostname)) {
    throw unprocessable(
      `GitHub Enterprise host ${hostname} is not allowed. Configure ${GITHUB_ENTERPRISE_HOSTS_ENV} to enable trusted Enterprise imports.`,
    );
  }
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw unprocessable("Invalid GitHub URL path encoding");
  }
}

export function encodeGitHubPath(value: string, label = "GitHub path") {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  const encodedSegments: string[] = [];
  for (const segment of normalized.split("/")) {
    const decoded = decodeSegment(segment).trim();
    if (!decoded || decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      throw unprocessable(`${label} must not contain empty or dot-dot path segments`);
    }
    encodedSegments.push(encodeURIComponent(decoded));
  }
  return encodedSegments.join("/");
}

export function assertSafeGitHubPath(value: string, label = "GitHub path") {
  encodeGitHubPath(value, label);
  return value;
}

export function gitHubApiBase(hostname: string) {
  assertAllowedGitHubHost(hostname);
  return isGitHubDotCom(hostname) ? "https://api.github.com" : `https://${normalizeGitHubHostname(hostname)}/api/v3`;
}

export function resolveRawGitHubUrl(hostname: string, owner: string, repo: string, ref: string, filePath: string) {
  assertAllowedGitHubHost(hostname);
  const safeOwner = encodeGitHubPath(owner, "GitHub owner");
  const safeRepo = encodeGitHubPath(repo, "GitHub repository");
  const safeRef = encodeGitHubPath(ref, "GitHub ref");
  const safeFilePath = encodeGitHubPath(filePath, "GitHub file path");
  if (!safeOwner || !safeRepo || !safeRef || !safeFilePath) {
    throw unprocessable("GitHub raw URL is missing required path components");
  }
  const h = normalizeGitHubHostname(hostname);
  return isGitHubDotCom(h)
    ? `https://raw.githubusercontent.com/${safeOwner}/${safeRepo}/${safeRef}/${safeFilePath}`
    : `https://${h}/raw/${safeOwner}/${safeRepo}/${safeRef}/${safeFilePath}`;
}

export async function ghFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw unprocessable(`Could not connect to ${new URL(url).hostname} — ensure the URL points to an allowed GitHub or GitHub Enterprise instance`);
  }
}
