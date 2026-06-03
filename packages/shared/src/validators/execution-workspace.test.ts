import { describe, expect, it } from "vitest";
import { updateExecutionWorkspaceSchema } from "./execution-workspace.js";

describe("updateExecutionWorkspaceSchema", () => {
  it("accepts normal git base refs", () => {
    expect(updateExecutionWorkspaceSchema.parse({ baseRef: "main" })).toEqual({ baseRef: "main" });
    expect(updateExecutionWorkspaceSchema.parse({ baseRef: "origin/feature/test" })).toEqual({
      baseRef: "origin/feature/test",
    });
  });

  it("rejects base refs that could be parsed as git options", () => {
    expect(() => updateExecutionWorkspaceSchema.parse({ baseRef: "--output=owned" })).toThrow();
    expect(() => updateExecutionWorkspaceSchema.parse({ baseRef: " main --output=owned" })).toThrow();
  });
});
