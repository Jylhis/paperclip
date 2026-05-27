import { z } from "@paperclipai/plugin-sdk";
import manifest from "./manifest.js";

// Subset of JSON schema actually used in src/manifest.ts. Keep this in sync if
// new shapes are introduced (e.g. integer, oneOf, $ref) — extending the
// compiler in this file is preferable to weakening validation.
type JsonPrimSchema =
  | { type: "string"; description?: string; enum?: readonly string[] }
  | { type: "number"; description?: string }
  | { type: "boolean"; description?: string };

type JsonArraySchema = {
  type: "array";
  description?: string;
  items?: JsonSchema;
};

type JsonObjectSchema = {
  type: "object";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
};

type JsonSchema = JsonPrimSchema | JsonArraySchema | JsonObjectSchema;

function compile(schema: JsonSchema | undefined): z.ZodTypeAny {
  if (!schema || typeof schema !== "object" || typeof schema.type !== "string") {
    return z.unknown();
  }
  if (schema.type === "string") {
    if (schema.enum && schema.enum.length > 0) {
      return z.enum(schema.enum as [string, ...string[]]);
    }
    return z.string();
  }
  if (schema.type === "number") return z.number();
  if (schema.type === "boolean") return z.boolean();
  if (schema.type === "array") {
    return z.array(compile(schema.items));
  }
  // object
  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(schema.required ?? []);
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    const zv = compile(value);
    shape[key] = required.has(key) ? zv : zv.optional();
  }
  return z.object(shape);
}

// Compiled once at module load: cheap and fixes the schema set per build.
const TOOL_PARAM_SCHEMAS: Map<string, z.ZodTypeAny> = (() => {
  const out = new Map<string, z.ZodTypeAny>();
  for (const decl of manifest.tools ?? []) {
    out.set(decl.name, compile(decl.parametersSchema as unknown as JsonSchema));
  }
  return out;
})();

export interface ToolParamValidation {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export function validateToolParams(toolName: string, params: unknown): ToolParamValidation {
  const schema = TOOL_PARAM_SCHEMAS.get(toolName);
  if (!schema) {
    // Unknown tool — let the dispatcher's own unknown-tool branch handle it.
    return { ok: true, data: (params ?? {}) as Record<string, unknown> };
  }
  const parsed = schema.safeParse(params ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue: z.ZodIssue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: `invalid params for ${toolName}: ${issues}` };
  }
  return { ok: true, data: parsed.data as Record<string, unknown> };
}
