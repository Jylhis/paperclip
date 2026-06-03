#!/usr/bin/env -S node --import tsx
import fs from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./dev-service-profile.ts";

type WorkspaceLinkMismatch = {
  workspaceDir: string;
  packageName: string;
  expectedPath: string;
  actualPath: string | null;
  linkPath: string;
};

const SAFE_PACKAGE_SEGMENT_RE = /^[a-z0-9][a-z0-9._~-]*$/;

function isSafeWorkspacePackageName(packageName: string): boolean {
  if (packageName.length === 0 || packageName.length > 214) return false;
  if (packageName.includes("\\")) return false;

  const segments = packageName.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment.length === 0)) return false;

  if (segments.length === 1) {
    return SAFE_PACKAGE_SEGMENT_RE.test(segments[0]);
  }

  if (segments.length === 2 && segments[0].startsWith("@")) {
    return SAFE_PACKAGE_SEGMENT_RE.test(segments[0].slice(1)) && SAFE_PACKAGE_SEGMENT_RE.test(segments[1]);
  }

  return false;
}

function resolveWorkspaceLinkPath(workspaceDir: string, packageName: string): string | null {
  if (!isSafeWorkspacePackageName(packageName)) return null;

  const nodeModulesRoot = path.resolve(repoRoot, workspaceDir, "node_modules");
  const linkPath = path.resolve(nodeModulesRoot, ...packageName.split("/"));
  const relativePath = path.relative(nodeModulesRoot, linkPath);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;

  return linkPath;
}

async function assertSafeWorkspaceLinkParent(nodeModulesRoot: string, linkPath: string) {
  const resolvedNodeModulesRoot = path.resolve(nodeModulesRoot);
  const resolvedLinkPath = path.resolve(linkPath);
  const relativeLinkPath = path.relative(resolvedNodeModulesRoot, resolvedLinkPath);
  if (relativeLinkPath === "" || relativeLinkPath.startsWith("..") || path.isAbsolute(relativeLinkPath)) {
    throw new Error(`Refusing to relink workspace package outside node_modules: ${linkPath}`);
  }

  await fs.mkdir(resolvedNodeModulesRoot, { recursive: true });
  const rootStat = await fs.lstat(resolvedNodeModulesRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`Refusing to relink workspace packages through unsafe node_modules path: ${resolvedNodeModulesRoot}`);
  }

  const parentPath = path.dirname(resolvedLinkPath);
  const relativeParentPath = path.relative(resolvedNodeModulesRoot, parentPath);
  const parentSegments = relativeParentPath === "" ? [] : relativeParentPath.split(path.sep);
  let currentPath = resolvedNodeModulesRoot;

  for (const segment of parentSegments) {
    currentPath = path.join(currentPath, segment);
    try {
      const stat = await fs.lstat(currentPath);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Refusing to relink workspace package through unsafe parent path: ${currentPath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fs.mkdir(currentPath);
    }
  }
}

function readJsonFile(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function discoverWorkspacePackagePaths(rootDir: string): Map<string, string> {
  const packagePaths = new Map<string, string>();
  const ignoredDirNames = new Set([".git", ".paperclip", "dist", "node_modules"]);

  function visit(dirPath: string) {
    const packageJsonPath = path.join(dirPath, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = readJsonFile(packageJsonPath);
      if (typeof packageJson.name === "string" && isSafeWorkspacePackageName(packageJson.name)) {
        packagePaths.set(packageJson.name, dirPath);
      }
    }

    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (ignoredDirNames.has(entry.name)) continue;
      visit(path.join(dirPath, entry.name));
    }
  }

  visit(path.join(rootDir, "packages"));
  visit(path.join(rootDir, "server"));
  visit(path.join(rootDir, "ui"));
  visit(path.join(rootDir, "cli"));

  return packagePaths;
}

const workspacePackagePaths = discoverWorkspacePackagePaths(repoRoot);
const workspaceDirs = Array.from(
  new Set(
    Array.from(workspacePackagePaths.values())
      .map((packagePath) => path.relative(repoRoot, packagePath))
      .filter((workspaceDir) => workspaceDir.length > 0),
  ),
).sort();

function findWorkspaceLinkMismatches(workspaceDir: string): WorkspaceLinkMismatch[] {
  const nodeModulesDir = path.join(repoRoot, workspaceDir, "node_modules");
  if (!existsSync(nodeModulesDir)) {
    return [];
  }

  const packageJson = readJsonFile(path.join(repoRoot, workspaceDir, "package.json"));
  const dependencies = {
    ...(packageJson.dependencies as Record<string, unknown> | undefined),
    ...(packageJson.devDependencies as Record<string, unknown> | undefined),
  };
  const mismatches: WorkspaceLinkMismatch[] = [];

  for (const [packageName, version] of Object.entries(dependencies)) {
    if (typeof version !== "string" || !version.startsWith("workspace:")) continue;

    const linkPath = resolveWorkspaceLinkPath(workspaceDir, packageName);
    if (!linkPath) continue;

    const expectedPath = workspacePackagePaths.get(packageName);
    if (!expectedPath) continue;

    const actualPath = existsSync(linkPath) ? path.resolve(realpathSync(linkPath)) : null;
    if (actualPath === path.resolve(expectedPath)) continue;

    mismatches.push({
      workspaceDir,
      packageName,
      expectedPath: path.resolve(expectedPath),
      actualPath,
      linkPath,
    });
  }

  return mismatches;
}

async function ensureWorkspaceLinksCurrent(workspaceDir: string) {
  const mismatches = findWorkspaceLinkMismatches(workspaceDir);
  if (mismatches.length === 0) return;

  console.log(`[paperclip] detected stale workspace package links for ${workspaceDir}; relinking dependencies...`);
  for (const mismatch of mismatches) {
    console.log(
      `[paperclip]   ${mismatch.packageName}: ${mismatch.actualPath ?? "missing"} -> ${mismatch.expectedPath}`,
    );
  }

  for (const mismatch of mismatches) {
    const nodeModulesRoot = path.resolve(repoRoot, mismatch.workspaceDir, "node_modules");
    await assertSafeWorkspaceLinkParent(nodeModulesRoot, mismatch.linkPath);
    await fs.rm(mismatch.linkPath, { recursive: true, force: true });
    await fs.symlink(mismatch.expectedPath, mismatch.linkPath);
  }

  const remainingMismatches = findWorkspaceLinkMismatches(workspaceDir);
  if (remainingMismatches.length === 0) return;

  throw new Error(
    `Workspace relink did not repair all ${workspaceDir} package links: ${remainingMismatches.map((item) => item.packageName).join(", ")}`,
  );
}

for (const workspaceDir of workspaceDirs) {
  await ensureWorkspaceLinksCurrent(workspaceDir);
}
