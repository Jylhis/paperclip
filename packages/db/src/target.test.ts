import { describe, expect, it } from "vitest";
import {
  describeTarget,
  type DatabaseTarget,
  postgresOptions,
  targetFromUrl,
} from "./target.js";

describe("targetFromUrl", () => {
  it("wraps a connection string into a url-kind target", () => {
    const target = targetFromUrl("postgres://user:pw@db.example.com:5432/paperclip");

    expect(target).toEqual({
      kind: "url",
      connectionString: "postgres://user:pw@db.example.com:5432/paperclip",
    });
  });
});

describe("describeTarget", () => {
  it("hides credentials when describing a url target", () => {
    const target: DatabaseTarget = {
      kind: "url",
      connectionString: "postgres://user:secret@db.example.com:5432/paperclip",
    };

    const description = describeTarget(target);

    expect(description).not.toContain("secret");
    expect(description).toContain("db.example.com");
    expect(description).toContain("paperclip");
  });

  it("describes a socket target by socket dir and database name", () => {
    const target: DatabaseTarget = {
      kind: "socket",
      socketDir: "/run/postgresql",
      database: "paperclip",
      user: "paperclip",
    };

    expect(describeTarget(target)).toBe("socket:/run/postgresql/paperclip");
  });

  it("describes a socket target with explicit port", () => {
    const target: DatabaseTarget = {
      kind: "socket",
      socketDir: "/run/postgresql",
      database: "paperclip",
      user: "paperclip",
      port: 5433,
    };

    expect(describeTarget(target)).toBe("socket:/run/postgresql:5433/paperclip");
  });
});

describe("postgresOptions", () => {
  it("returns the connection string as a single positional argument for url targets", () => {
    const args = postgresOptions({
      kind: "url",
      connectionString: "postgres://user:pw@db.example.com:5432/paperclip",
    });

    expect(args).toEqual(["postgres://user:pw@db.example.com:5432/paperclip"]);
  });

  it("returns a single options object for socket targets without a port", () => {
    const args = postgresOptions({
      kind: "socket",
      socketDir: "/run/postgresql",
      database: "paperclip",
      user: "paperclip",
    });

    expect(args).toHaveLength(1);
    expect(args[0]).toEqual({
      host: "/run/postgresql",
      database: "paperclip",
      username: "paperclip",
    });
  });

  it("includes the port when the socket target specifies one", () => {
    const args = postgresOptions({
      kind: "socket",
      socketDir: "/run/postgresql",
      database: "paperclip",
      user: "paperclip",
      port: 5433,
    });

    expect(args[0]).toEqual({
      host: "/run/postgresql",
      database: "paperclip",
      username: "paperclip",
      port: 5433,
    });
  });
});
