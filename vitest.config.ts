import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Coverage is disabled by default so ordinary `vitest run` invocations stay
    // fast and do not require the coverage provider to be installed. The coverage
    // jobs in .github/workflows/sonarqube.yml opt in via PAPERCLIP_COVERAGE=1,
    // which makes scripts/run-vitest-stable.mjs pass `--coverage.enabled=true`.
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "./coverage",
      all: false,
      include: [
        "server/src/**/*.{ts,tsx}",
        "ui/src/**/*.{ts,tsx}",
        "cli/src/**/*.{ts,tsx}",
        "packages/*/src/**/*.{ts,tsx}",
        "packages/adapters/*/src/**/*.{ts,tsx}",
        "packages/plugins/*/src/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/__tests__/**",
        "**/__mocks__/**",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/*.stories.{ts,tsx}",
        "**/*.d.ts",
        "**/dist/**",
        "**/node_modules/**",
        "**/vitest.setup.ts",
        "**/*.config.{ts,mts,mjs,js}",
      ],
    },
    projects: [
      "packages/shared",
      "packages/db",
      "packages/adapter-utils",
      "packages/adapters/acpx-local",
      "packages/adapters/claude-local",
      "packages/adapters/codex-local",
      "packages/adapters/cursor-cloud",
      "packages/adapters/cursor-local",
      "packages/adapters/gemini-local",
      "packages/adapters/grok-local",
      "packages/adapters/opencode-local",
      "packages/adapters/pi-local",
      "packages/plugins/sdk",
      "server",
      "ui",
      "cli",
    ],
  },
});
