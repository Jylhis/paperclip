/**
 * Tests for the trusted-origin enforcement added to scripts/screenshot.cjs.
 * Runs the script as a subprocess with a synthetic auth.json to verify that
 * the origin guard fires before any browser is launched.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "screenshot.cjs",
);

function makeHome(apiBase) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "screenshot-origin-test-"));
  const authDir = path.join(tmpDir, ".paperclip");
  mkdirSync(authDir, { recursive: true });
  writeFileSync(
    path.join(authDir, "auth.json"),
    JSON.stringify({
      credentials: { default: { token: "tok-test", apiBase } },
    }),
  );
  return tmpDir;
}

function runScript(homeDir, rawUrl) {
  return spawnSync(process.execPath, [scriptPath, rawUrl, "/tmp/screenshot-test-out.png"], {
    env: { ...process.env, HOME: homeDir },
    encoding: "utf-8",
  });
}

const TRUSTED = "https://paperclip.example.com";
const REJECT_MSG = "Refusing to send board token to untrusted origin";

test("rejects absolute URL whose origin differs from apiBase", () => {
  const home = makeHome(TRUSTED);
  try {
    const result = runScript(home, "http://evil.com/steal-token");
    assert.equal(result.status, 1, "should exit 1");
    assert.ok(result.stderr.includes(REJECT_MSG), `expected rejection, got: ${result.stderr}`);
    assert.ok(result.stderr.includes("http://evil.com"), `should name the bad origin, got: ${result.stderr}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("rejects absolute HTTPS URL pointing to a different host", () => {
  const home = makeHome(TRUSTED);
  try {
    const result = runScript(home, "https://attacker.net/path");
    assert.equal(result.status, 1, "should exit 1");
    assert.ok(result.stderr.includes(REJECT_MSG), `expected rejection, got: ${result.stderr}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("rejects protocol-relative URL pointing to an untrusted host", () => {
  const home = makeHome(TRUSTED);
  try {
    // //evil.com/path does not start with 'http', so it goes through
    // new URL("//evil.com/path", baseUrl) which yields https://evil.com/path —
    // that origin must be caught by the guard.
    const result = runScript(home, "//evil.com/path");
    assert.equal(result.status, 1, "should exit 1");
    assert.ok(result.stderr.includes(REJECT_MSG), `expected rejection, got: ${result.stderr}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("passes origin check for absolute URL matching apiBase origin", () => {
  const home = makeHome(TRUSTED);
  try {
    const result = runScript(home, `${TRUSTED}/dashboard`);
    // Origin guard should NOT fire. The script may fail further due to missing
    // Playwright in this environment, but the rejection message must be absent.
    assert.ok(
      !result.stderr.includes(REJECT_MSG),
      `should pass origin check, got stderr: ${result.stderr}`,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("passes origin check for a relative path (resolves to apiBase origin)", () => {
  const home = makeHome(TRUSTED);
  try {
    const result = runScript(home, "/JYL/agents/cto");
    assert.ok(
      !result.stderr.includes(REJECT_MSG),
      `should pass origin check for relative path, got stderr: ${result.stderr}`,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("exits non-zero when no board token is present", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "screenshot-noauth-"));
  try {
    const result = runScript(home, `${TRUSTED}/dashboard`);
    assert.equal(result.status, 1, "should exit 1 with no auth");
    assert.ok(
      result.stderr.includes("No board token found"),
      `expected auth error, got: ${result.stderr}`,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
