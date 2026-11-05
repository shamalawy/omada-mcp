/**
 * Turns OpenAPI 3.0 schemas (with $ref) into self-contained JSON Schema
 * that MCP clients and models can read directly.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonSchema = Record<string, any>;

const DROP_KEYS = new Set(["example", "examples", "xml", "externalDocs", "discriminator"]);

export function refName(ref: string): string {
  return ref.slice(ref.lastIndexOf("/") + 1);
}

/**
 * Inline every $ref. Recursive schemas are cut at the first repeat, and
 * nesting deeper than `maxDepth` $refs is replaced by a pointer the model
 * can expand with omada_get_schema.
 */
export function resolveSchema(
  schemas: Record<string, JsonSchema>,
  node: unknown,
  maxDepth = 8,
): JsonSchema {
  return walk(schemas, node, 0, [], maxDepth) as JsonSchema;
}

function walk(
  schemas: Record<string, JsonSchema>,
  node: unknown,
  depth: number,
  stack: string[],
  maxDepth: number,
): unknown {
  if (Array.isArray(node)) return node.map((n) => walk(schemas, n, depth, stack, maxDepth));
  if (!node || typeof node !== "object") return node;
  const obj = node as JsonSchema;

  if (typeof obj.$ref === "string") {
    const name = refName(obj.$ref);
    const { $ref: _ignored, ...siblings } = obj;
    const extra = walk(schemas, siblings, depth, stack, maxDepth) as JsonSchema;
    if (stack.includes(name)) {
      return {
        type: "object",
        ...extra,
        description: joinDesc(extra.description, `(recursive ${name}; see omada_get_schema "${name}")`),
      };
    }
    if (depth >= maxDepth) {
      return {
        type: "object",
        ...extra,
        description: joinDesc(extra.description, `(${name} not expanded; call omada_get_schema "${name}")`),
      };
    }
    const target = schemas[name];
    if (!target) return { ...extra, description: joinDesc(extra.description, `(unknown schema ${name})`) };
    const resolved = walk(schemas, target, depth + 1, [...stack, name], maxDepth) as JsonSchema;
    return { ...resolved, ...extra };
  }

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(obj)) {
    if (DROP_KEYS.has(key) || key.startsWith("x-")) continue;
    if (key === "properties" && value && typeof value === "object") {
      const props: JsonSchema = {};
      for (const [p, s] of Object.entries(value as JsonSchema)) props[p] = walk(schemas, s, depth, stack, maxDepth);
      out.properties = props;
    } else if (key === "nullable") {
      // OpenAPI 3.0 only; JSON Schema has no equivalent keyword. Dropped.
      continue;
    } else if (["items", "additionalProperties", "not", "allOf", "oneOf", "anyOf"].includes(key)) {
      out[key] = walk(schemas, value, depth, stack, maxDepth);
    } else {
      out[key] = value;
    }
  }
  // The Omada spec repeats the parent's description on array items; drop the copy.
  if (out.type === "array" && out.items && out.items.description === out.description) {
    const { description: _d, ...rest } = out.items as JsonSchema;
    out.items = rest;
  }
  return out;
}

function joinDesc(a: unknown, b: string): string {
  return typeof a === "string" && a ? `${a} ${b}` : b;
}

/** True when a (resolved) schema describes a binary file part. */
export function isBinary(schema: JsonSchema | undefined): boolean {
  if (!schema) return false;
  if (schema.format === "binary") return true;
  return schema.type === "array" && schema.items?.format === "binary";
}
