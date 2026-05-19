const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidSecretRef(value: string): boolean {
  return UUID_RE.test(value);
}

export function collectSecretRefPaths(
  schema: Record<string, unknown> | null | undefined,
): Set<string> {
  const paths = new Set<string>();
  if (!schema || typeof schema !== "object") return paths;

  function walk(node: Record<string, unknown>, prefix: string): void {
    for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
      const branches = node[keyword];
      if (!Array.isArray(branches)) continue;
      for (const branch of branches) {
        if (!branch || typeof branch !== "object" || Array.isArray(branch)) continue;
        walk(branch as Record<string, unknown>, prefix);
      }
    }

    const properties = node.properties as Record<string, Record<string, unknown>> | undefined;
    if (properties && typeof properties === "object") {
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (!propertySchema || typeof propertySchema !== "object") continue;
        const path = prefix ? `${prefix}.${escapePathSegment(key)}` : escapePathSegment(key);
        if (propertySchema.format === "secret-ref") {
          paths.add(path);
        }
        walk(propertySchema, path);
      }
    }

    const items = node.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const path = prefix ? `${prefix}.*` : "*";
        walk(item as Record<string, unknown>, path);
      }
      return;
    }
    if (!items || typeof items !== "object") return;
    const path = prefix ? `${prefix}.*` : "*";
    walk(items as Record<string, unknown>, path);
  }

  walk(schema, "");
  return paths;
}

function escapePathSegment(key: string): string {
  return key.replaceAll("\\", "\\\\").replaceAll(".", "\\.");
}

function splitPath(path: string): string[] {
  const parts: string[] = [];
  let current = "";
  let escaped = false;
  for (const ch of path) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === ".") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

export function readConfigValueAtPath(
  config: Record<string, unknown>,
  dotPath: string,
): unknown {
  const keys = splitPath(dotPath);
  const values: unknown[] = [];
  function walk(current: unknown, index: number): void {
    if (index >= keys.length) {
      values.push(current);
      return;
    }
    const key = keys[index]!;
    if (key === "*") {
      if (!Array.isArray(current)) return;
      for (const item of current) {
        walk(item, index + 1);
      }
      return;
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) return;
    walk((current as Record<string, unknown>)[key], index + 1);
  }
  walk(config, 0);
  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0];
  return values;
}

export function writeConfigValueAtPath(
  config: Record<string, unknown>,
  dotPath: string,
  value: unknown,
): Record<string, unknown> {
  const result = structuredClone(config) as Record<string, unknown>;
  const keys = splitPath(dotPath);

  function write(current: unknown, index: number): void {
    if (index >= keys.length) return;
    const key = keys[index]!;
    if (key === "*") {
      if (!Array.isArray(current)) return;
      for (const item of current) {
        write(item, index + 1);
      }
      return;
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) return;
    const cursor = current as Record<string, unknown>;
    if (index === keys.length - 1) {
      if (value === undefined) delete cursor[key];
      else cursor[key] = value;
      return;
    }
    const next = cursor[key];
    if (!next || typeof next !== "object") {
      cursor[key] = keys[index + 1] === "*" ? [] : {};
    }
    write(cursor[key], index + 1);
  }

  write(result, 0);
  return result;
}
