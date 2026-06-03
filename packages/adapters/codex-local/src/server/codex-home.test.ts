import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareManagedCodexHome, resolveTrustedConfiguredCodexHomeDir } from "./codex-home.js";

describe("codex managed home", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats a concurrently-created expected auth symlink as success", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-home-"));
    const sharedCodexHome = path.join(root, "shared-codex-home");
    const paperclipHome = path.join(root, "paperclip-home");
    const managedCodexHome = path.join(
      paperclipHome,
      "instances",
      "default",
      "companies",
      "company-1",
      "codex-home",
    );
    const sharedAuth = path.join(sharedCodexHome, "auth.json");
    const managedAuth = path.join(managedCodexHome, "auth.json");

    await fs.mkdir(sharedCodexHome, { recursive: true });
    await fs.writeFile(sharedAuth, '{"token":"shared"}\n', "utf8");

    const originalSymlink = fs.symlink.bind(fs);
    vi.spyOn(fs, "symlink").mockImplementationOnce(async (source, target, type) => {
      await originalSymlink(source, target, type);
      const error = new Error("file already exists") as NodeJS.ErrnoException;
      error.code = "EEXIST";
      throw error;
    });

    try {
      await expect(
        prepareManagedCodexHome(
          {
            CODEX_HOME: sharedCodexHome,
            PAPERCLIP_HOME: paperclipHome,
            PAPERCLIP_INSTANCE_ID: "default",
          },
          async () => {},
          "company-1",
        ),
      ).resolves.toBe(managedCodexHome);

      expect((await fs.lstat(managedAuth)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(managedAuth)).toBe(await fs.realpath(sharedAuth));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects configured CODEX_HOME outside the company-managed Codex home", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-home-"));
    const paperclipHome = path.join(root, "paperclip-home");
    const victimHome = path.join(
      paperclipHome,
      "instances",
      "default",
      "companies",
      "victim-company",
      "codex-home",
    );

    try {
      await expect(
        resolveTrustedConfiguredCodexHomeDir(
          {
            PAPERCLIP_HOME: paperclipHome,
            PAPERCLIP_INSTANCE_ID: "default",
          },
          "attacker-company",
          victimHome,
        ),
      ).rejects.toThrow(/outside the Paperclip-managed Codex home/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("allows configured CODEX_HOME inside the company-managed Codex home", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-home-"));
    const paperclipHome = path.join(root, "paperclip-home");
    const customHome = path.join(
      paperclipHome,
      "instances",
      "default",
      "companies",
      "company-1",
      "codex-home",
      "custom",
    );

    try {
      await expect(
        resolveTrustedConfiguredCodexHomeDir(
          {
            PAPERCLIP_HOME: paperclipHome,
            PAPERCLIP_INSTANCE_ID: "default",
          },
          "company-1",
          customHome,
        ),
      ).resolves.toBe(customHome);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects configured CODEX_HOME with an existing symlink path component", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-home-"));
    const paperclipHome = path.join(root, "paperclip-home");
    const managedHome = path.join(
      paperclipHome,
      "instances",
      "default",
      "companies",
      "company-1",
      "codex-home",
    );
    const outsideHome = path.join(root, "outside");
    const symlinkHome = path.join(managedHome, "linked-home");

    try {
      await fs.mkdir(managedHome, { recursive: true });
      await fs.mkdir(outsideHome, { recursive: true });
      await fs.symlink(outsideHome, symlinkHome);

      await expect(
        resolveTrustedConfiguredCodexHomeDir(
          {
            PAPERCLIP_HOME: paperclipHome,
            PAPERCLIP_INSTANCE_ID: "default",
          },
          "company-1",
          path.join(symlinkHome, "nested"),
        ),
      ).rejects.toThrow(/symlink component/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

});
