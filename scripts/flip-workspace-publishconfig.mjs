#!/usr/bin/env node
// Apply each workspace package's publishConfig.{exports,main,types} into the
// top level so consumers resolve workspace imports to `dist/*.js` instead of
// `src/*.ts`. Mirrors `pnpm pack` / `pnpm publish` transformation.
//
// Run after all workspace packages are built (`pnpm -r build` or
// `pnpm --filter @paperclipai/server... build`). Used by the Nix buildPhase
// so the produced binary can be invoked as plain `node dist/index.js`
// without a runtime TS loader.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const roots = ["server", "cli", "ui", "packages"];
const repoRoot = process.argv[2] ?? process.cwd();

const findOutput = execSync(
  `find ${roots.join(" ")} -name package.json -not -path '*/node_modules/*' -not -path '*/dist/*'`,
  { cwd: repoRoot, encoding: "utf8" },
);
const pkgPaths = findOutput.trim().split("\n").filter(Boolean);

let flipped = 0;
for (const rel of pkgPaths) {
  const p = path.join(repoRoot, rel);
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!pkg.publishConfig) continue;
  if (pkg.publishConfig.exports) pkg.exports = pkg.publishConfig.exports;
  if (pkg.publishConfig.main)    pkg.main    = pkg.publishConfig.main;
  if (pkg.publishConfig.types)   pkg.types   = pkg.publishConfig.types;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
  flipped++;
  console.log(`flipped ${rel}`);
}
console.log(`Flipped publishConfig in ${flipped} workspace package(s)`);
