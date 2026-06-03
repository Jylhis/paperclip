import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectGuardrailFailures, runCheck } from "./check-workflow-guardrails.mjs";

test("repo workflows satisfy CI guardrails", () => {
  const failures = collectGuardrailFailures(process.cwd());
  assert.deepEqual(failures, []);
});

test("runCheck reports missing workflow guardrails", () => {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "workflow-guardrails-"));
  try {
    const workflowsDir = path.join(tmpRoot, ".github/workflows");
    mkdirSync(workflowsDir, { recursive: true });

    for (const workflow of [
      "canon.yml",
      "docker.yml",
      "e2e.yml",
      "pr.yml",
      "refresh-lockfile.yml",
      "release-smoke.yml",
      "release.yml",
      "sonarqube.yml",
    ]) {
      writeFileSync(path.join(workflowsDir, workflow), "name: Test\non: workflow_dispatch\n");
    }

    const errors = [];
    const code = runCheck({
      repoRoot: tmpRoot,
      log: () => {},
      error: (message) => errors.push(message),
    });

    assert.equal(code, 1);
    assert.ok(errors.some((line) => line.includes("canon.yml: missing top-level standard concurrency")));
    assert.ok(errors.some((line) => line.includes("sonarqube.yml: missing daily schedule for full matrix")));
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
