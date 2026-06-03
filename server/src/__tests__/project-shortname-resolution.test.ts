import { describe, expect, it } from "vitest";
import { resolveProjectNameForUniqueShortname } from "../services/projects.ts";

describe("resolveProjectNameForUniqueShortname", () => {
  it("keeps name when shortname is not used", () => {
    const resolved = resolveProjectNameForUniqueShortname("Platform", [
      { id: "p1", name: "Growth" },
    ]);
    expect(resolved).toBe("Platform");
  });

  it("appends numeric suffix when shortname collides", () => {
    const resolved = resolveProjectNameForUniqueShortname("Growth Team", [
      { id: "p1", name: "growth-team" },
    ]);
    expect(resolved).toBe("Growth Team 2");
  });

  it("increments suffix until unique", () => {
    const resolved = resolveProjectNameForUniqueShortname("Growth Team", [
      { id: "p1", name: "growth-team" },
      { id: "p2", name: "growth-team-2" },
    ]);
    expect(resolved).toBe("Growth Team 3");
  });

  it("ignores excluded project id", () => {
    const resolved = resolveProjectNameForUniqueShortname(
      "Growth Team",
      [
        { id: "p1", name: "growth-team" },
        { id: "p2", name: "platform" },
      ],
      { excludeProjectId: "p1" },
    );
    expect(resolved).toBe("Growth Team");
  });

  it("keeps non-normalizable names unchanged", () => {
    const resolved = resolveProjectNameForUniqueShortname("!!!", [
      { id: "p1", name: "growth" },
    ]);
    expect(resolved).toBe("!!!");
  });

  it("avoids collisions with derived non-ASCII url keys", () => {
    const resolved = resolveProjectNameForUniqueShortname("12345678", [
      { id: "12345678-1234-4abc-8def-123456789abc", name: "部署" },
    ]);
    expect(resolved).toBe("12345678 2");
  });

  it("avoids collisions with derived mixed-ascii url keys", () => {
    const resolved = resolveProjectNameForUniqueShortname("foo-12345678", [
      { id: "12345678-1234-4abc-8def-123456789def", name: "fooé" },
    ]);
    expect(resolved).toBe("foo-12345678 2");
  });
});
