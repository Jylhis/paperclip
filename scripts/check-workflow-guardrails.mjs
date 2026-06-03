#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CONCURRENCY_PATTERN =
  /concurrency:\n\s+group:\s+\$\{\{\s*github\.workflow\s*\}\}-\$\{\{\s*github\.ref\s*\}\}\n\s+cancel-in-progress:\s+true/m;

const DOCS_IGNORE_PATTERN = /paths-ignore:\n[\s\S]*?-\s+["']?doc\/\*\*["']?\n[\s\S]*?-\s+["']?docs\/\*\*["']?\n[\s\S]*?-\s+["']?\*\*\/\*\.md["']?\n[\s\S]*?-\s+["']?README\.md["']?\n[\s\S]*?-\s+["']?LICENSE["']?/m;

const SCHEDULE_DAILY_PATTERN =
  /schedule:\n(?:\s+#.*\n)*\s+-\s+cron:\s+['"]\d+\s+\d+\s+\*\s+\*\s+\*['"]/m;

const NIX_CACHE_PATTERN =
  /uses:\s+actions\/cache@v4\n\s+with:\n\s+path:\s+~\/\.cache\/nix\n\s+key:\s+\$\{\{\s*runner\.os\s*\}\}-nix-\$\{\{\s*hashFiles\('flake\.lock'\)\s*\}\}/m;

const EXPECTATIONS = [
  {
    workflow: "canon.yml",
    patterns: [
      {
        description: "top-level standard concurrency",
        pattern: CONCURRENCY_PATTERN,
      },
      {
        description: "scoped canon paths",
        pattern: /paths:\n(?:\s+-\s+(?:\.github\/workflows\/canon\.yml|AGENTS\.md|ENGINEERING_PRINCIPLES\.md|WAY_OF_WORKING\.md|README\.md|LICENSE)\n)+/m,
      },
      { description: "nix cache step", pattern: NIX_CACHE_PATTERN },
    ],
  },
  {
    workflow: "docker.yml",
    patterns: [
      { description: "top-level standard concurrency", pattern: CONCURRENCY_PATTERN },
      { description: "docs-only push filter", pattern: DOCS_IGNORE_PATTERN },
      { description: "nix cache step", pattern: NIX_CACHE_PATTERN },
    ],
  },
  {
    workflow: "e2e.yml",
    patterns: [
      { description: "top-level standard concurrency", pattern: CONCURRENCY_PATTERN },
      { description: "nix cache step", pattern: NIX_CACHE_PATTERN },
    ],
  },
  {
    workflow: "pr.yml",
    patterns: [
      { description: "top-level standard concurrency", pattern: CONCURRENCY_PATTERN },
      { description: "docs-only pull_request filter", pattern: DOCS_IGNORE_PATTERN },
      { description: "nix cache step", pattern: NIX_CACHE_PATTERN },
      {
        description: "draft PR guard on typecheck job",
        pattern: /^  typecheck_release_registry:\n(?:\s+.*\n){0,3}\s+if:\s+github\.event\.pull_request\.draft == false/m,
      },
      {
        description: "draft PR guard on grouped tests job",
        pattern: /^  general_tests:\n(?:\s+.*\n){0,3}\s+if:\s+github\.event\.pull_request\.draft == false/m,
      },
      {
        description: "draft PR guard on build job",
        pattern: /^  build:\n(?:\s+.*\n){0,3}\s+if:\s+github\.event\.pull_request\.draft == false/m,
      },
      {
        description: "draft PR guard on serialized suites job",
        pattern: /^  verify_serialized_server:\n(?:\s+.*\n){0,3}\s+if:\s+github\.event\.pull_request\.draft == false/m,
      },
      {
        description: "draft PR guard on canary dry run job",
        pattern: /^  canary_dry_run:\n(?:\s+.*\n){0,3}\s+if:\s+github\.event\.pull_request\.draft == false/m,
      },
      {
        description: "draft PR guard on e2e job",
        pattern: /^  e2e:\n(?:\s+.*\n){0,3}\s+if:\s+github\.event\.pull_request\.draft == false/m,
      },
      {
        description: "draft PR guard on verify job",
        pattern: /^  verify:\n[\s\S]*?\n\s+if:\s+\$\{\{\s*always\(\)\s*&&\s*github\.event\.pull_request\.draft == false\s*\}\}/m,
      },
    ],
  },
  {
    workflow: "refresh-lockfile.yml",
    patterns: [
      { description: "top-level standard concurrency", pattern: CONCURRENCY_PATTERN },
      { description: "docs-only push filter", pattern: DOCS_IGNORE_PATTERN },
      { description: "nix cache step", pattern: NIX_CACHE_PATTERN },
    ],
  },
  {
    workflow: "release-smoke.yml",
    patterns: [
      { description: "top-level standard concurrency", pattern: CONCURRENCY_PATTERN },
      { description: "nix cache step", pattern: NIX_CACHE_PATTERN },
    ],
  },
  {
    workflow: "release.yml",
    patterns: [
      { description: "top-level standard concurrency", pattern: CONCURRENCY_PATTERN },
      { description: "docs-only push filter", pattern: DOCS_IGNORE_PATTERN },
      { description: "nix cache step", pattern: NIX_CACHE_PATTERN },
    ],
  },
  {
    workflow: "sonarqube.yml",
    patterns: [
      { description: "top-level standard concurrency", pattern: CONCURRENCY_PATTERN },
      { description: "docs-only push/pull_request filters", pattern: DOCS_IGNORE_PATTERN },
      { description: "nix cache step", pattern: NIX_CACHE_PATTERN },
      { description: "daily schedule for full matrix", pattern: SCHEDULE_DAILY_PATTERN },
      {
        description: "scheduled-only coverage matrix",
        pattern: /coverage:\n[\s\S]*?\n\s+if:\s+github\.event_name == 'schedule'/m,
      },
    ],
  },
];

function readWorkflow(repoRoot, workflow) {
  return readFileSync(path.join(repoRoot, ".github/workflows", workflow), "utf8");
}

export function collectGuardrailFailures(repoRoot) {
  const failures = [];

  for (const { workflow, patterns } of EXPECTATIONS) {
    const text = readWorkflow(repoRoot, workflow);
    for (const { description, pattern } of patterns) {
      if (!pattern.test(text)) {
        failures.push(`${workflow}: missing ${description}`);
      }
    }
  }

  return failures;
}

export function runCheck({ repoRoot, log = console.log, error = console.error } = {}) {
  const failures = collectGuardrailFailures(repoRoot);
  if (failures.length === 0) {
    log("  ✓  Workflow guardrails are present.");
    return 0;
  }

  error("ERROR: workflow guardrail check failed:\n");
  for (const failure of failures) {
    error(`  - ${failure}`);
  }
  return 1;
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  process.exit(runCheck({ repoRoot: process.cwd() }));
}
