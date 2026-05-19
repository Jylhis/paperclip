import { describe, expect, it } from "vitest";
import {
  collectSecretRefPaths,
  readConfigValueAtPath,
  writeConfigValueAtPath,
} from "../services/json-schema-secret-refs.ts";

describe("collectSecretRefPaths", () => {
  it("collects nested secret-ref paths from object properties", () => {
    expect(Array.from(collectSecretRefPaths({
      type: "object",
      properties: {
        credentials: {
          type: "object",
          properties: {
            apiKey: { type: "string", format: "secret-ref" },
          },
        },
      },
    }))).toEqual(["credentials.apiKey"]);
  });

  it("collects secret-ref paths from JSON Schema composition keywords", () => {
    expect(Array.from(collectSecretRefPaths({
      type: "object",
      allOf: [
        {
          properties: {
            apiKey: { type: "string", format: "secret-ref" },
          },
        },
        {
          properties: {
            nested: {
              oneOf: [
                {
                  properties: {
                    token: { type: "string", format: "secret-ref" },
                  },
                },
              ],
            },
          },
        },
      ],
    })).sort()).toEqual(["apiKey", "nested.token"]);
  });

  it("collects array item secret-ref paths and escapes dotted property names", () => {
    expect(Array.from(collectSecretRefPaths({
      type: "object",
      properties: {
        credentials: {
          type: "array",
          items: {
            type: "object",
            properties: {
              "api.key": { type: "string", format: "secret-ref" },
            },
          },
        },
      },
    }))).toEqual(["credentials.*.api\\.key"]);
  });
});

describe("readConfigValueAtPath/writeConfigValueAtPath", () => {
  it("reads and writes wildcard array values", () => {
    const config = {
      credentials: [{ apiKey: "one" }, { apiKey: "two" }],
    };
    expect(readConfigValueAtPath(config, "credentials.*.apiKey")).toEqual(["one", "two"]);
    expect(writeConfigValueAtPath(config, "credentials.*.apiKey", "secret-id")).toEqual({
      credentials: [{ apiKey: "secret-id" }, { apiKey: "secret-id" }],
    });
  });

  it("supports dotted property names via escaped path segments", () => {
    const config = { credentials: { "api.key": "value" } };
    expect(readConfigValueAtPath(config, "credentials.api\\.key")).toBe("value");
  });
});
