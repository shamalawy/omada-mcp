/**
 * MCP tool definitions.
 *
 * Always available ("meta" tools) — together they reach every operation:
 *   omada_list_tags, omada_search_operations, omada_describe_operation,
 *   omada_call_operation, omada_get_schema, omada_request, omada_status
 *
 * With OMADA_TOOL_MODE=full, every (filtered) operation is also exposed as
 * its own tool, named by its operationId.
 */
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { OmadaClient } from "./client.js";
import type { Config } from "./config.js";
import { OmadaError } from "./errors.js";
import { AUTO_ID_PARAMS, errorResult, executeOperation, flattenQuery, formatResponse, type CallArgs, type FileInput } from "./executor.js";
import { multipartParts, type ApiSpec, type Operation } from "./spec.js";
import type { JsonSchema } from "./schema.js";
import type { QueryPairs } from "./client.js";

export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

export interface ToolContext {
  cfg: Config;
  client: OmadaClient;
  spec: ApiSpec;
}

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };

const FILES_SCHEMA: JsonSchema = {
  type: "object",
  description:
    'Files for multipart uploads, keyed by form field name (usually "file"). Each value gives one of path (local file), base64, or text.',
  additionalProperties: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to a local file" },
      base64: { type: "string", description: "File content, base64-encoded" },
      text: { type: "string", description: "File content as plain text" },
      filename: { type: "string", description: "File name to send (defaults to the path's base name)" },
      contentType: { type: "string", description: "MIME type (guessed from the file name if omitted)" },
    },
  },
};

/** Operations the server is allowed to expose, after include/exclude filters. */
export function allowedOperations(cfg: Config, spec: ApiSpec): Operation[] {
  const lower = (xs?: string[]) => xs?.map((x) => x.toLowerCase());
  const include = lower(cfg.includeTags);
  const exclude = lower(cfg.excludeTags);
  return spec.operations.filter((op) => {
    const tags = op.tags.map((t) => t.toLowerCase());
    if (include && !tags.some((t) => include.includes(t))) return false;
    if (exclude && tags.some((t) => exclude.includes(t))) return false;
    if (cfg.includeOperations && !cfg.includeOperations.test(op.operationId)) return false;
    if (cfg.excludeOperations && cfg.excludeOperations.test(op.operationId)) return false;
    if (cfg.excludeDeprecated && op.deprecated) return false;
    if (cfg.readOnly && op.method !== "GET") return false;
    return true;
  });
}

export function buildTools(ctx: ToolContext): ToolDef[] {
  const { cfg, client, spec } = ctx;
  const ops = allowedOperations(cfg, spec);
  const allowed = new Map(ops.map((op) => [op.operationId.toLowerCase(), op]));

  const findOp = (id: unknown): Operation => {
    if (typeof id !== "string" || !id.trim()) throw new OmadaError("operationId is required.");
    const op = allowed.get(id.trim().toLowerCase());
    if (op) return op;
    if (spec.get(id)) {
      throw new OmadaError(`Operation "${id}" exists but is disabled by this server's configuration (filters or read-only mode).`);
    }
    const close = spec.search(id, { limit: 5 }, ops).map((o) => o.operationId);
    throw new OmadaError(`Unknown operationId "${id}".${close.length ? ` Did you mean: ${close.join(", ")}?` : ""}`);
  };

  const tools: ToolDef[] = [
    {
      name: "omada_list_tags",
      title: "List Omada API categories",
      description:
        "List the categories (tags) of the Omada Open API with how many operations each has. Use a tag with omada_search_operations to browse one area (e.g. Site, Device, Client, Wireless, Ap, Switch, Gateway).",
      inputSchema: {
        type: "object",
        properties: { filter: { type: "string", description: "Only tags containing this text (case-insensitive)" } },
      },
      annotations: READ_ONLY,
      handler: async (args) => {
        const filter = typeof args.filter === "string" ? args.filter.toLowerCase() : "";
        const counts = new Map<string, number>();
        for (const op of ops) for (const t of op.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
        const lines = [...counts.entries()]
          .filter(([t]) => !filter || t.toLowerCase().includes(filter))
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([t, n]) => {
            const d = spec.tags.get(t)?.description;
            return `${t} (${n})${d && d !== t ? ` — ${d}` : ""}`;
          });
        return text(`${lines.length} categories, ${ops.length} operations:\n${lines.join("\n")}`);
      },
    },
    {
      name: "omada_search_operations",
      title: "Search Omada API operations",
      description:
        "Find Omada Open API operations by keywords (matches operationId, summary, category, path, description). Returns operationId, HTTP method, path and summary. Next: omada_describe_operation, then omada_call_operation.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: 'Keywords, e.g. "list clients", "reboot device", "create wlan ssid"' },
          tag: { type: "string", description: "Only operations in this category (see omada_list_tags)" },
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "Only this HTTP method" },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 20 },
        },
      },
      annotations: READ_ONLY,
      handler: async (args) => {
        const query = typeof args.query === "string" ? args.query : "";
        const tag = typeof args.tag === "string" ? args.tag : undefined;
        if (!query && !tag) throw new OmadaError("Give a query and/or a tag.");
        const limit = clampInt(args.limit, 1, 200, 20);
        const hits = spec.search(query, { tag, method: str(args.method), limit }, ops);
        if (!hits.length) return text("No matching operations. Try other words, or omada_list_tags to browse.");
        return text(hits.map(opLine).join("\n"));
      },
    },
    {
      name: "omada_describe_operation",
      title: "Describe an Omada API operation",
      description:
        "Show everything needed to call one operation: method, path, path/query parameters, request body JSON schema, required permissions and error codes. Optionally the response schema.",
      inputSchema: {
        type: "object",
        properties: {
          operationId: { type: "string", description: "From omada_search_operations" },
          includeResponseSchema: { type: "boolean", default: false, description: "Also show the schema of the result" },
        },
        required: ["operationId"],
      },
      annotations: READ_ONLY,
      handler: async (args) => text(describe(ctx, findOp(args.operationId), args.includeResponseSchema === true)),
    },
    {
      name: "omada_call_operation",
      title: "Call an Omada API operation",
      description: [
        "Run any Omada Open API operation by operationId.",
        "params: path and query parameters by name (e.g. {\"siteId\": \"Home\", \"page\": 1, \"pageSize\": 100}).",
        "omadacId/mspId are filled in automatically; siteId accepts a site ID or a site name" +
          (cfg.defaultSite ? ` (default: ${cfg.defaultSite})` : "") +
          "; page/pageSize default to 1/100 when required.",
        "body: JSON request body. files: uploads for multipart operations.",
        "Reply is the controller's JSON: {errorCode, msg, result}; errorCode 0 means success.",
      ].join(" "),
      inputSchema: {
        type: "object",
        properties: {
          operationId: { type: "string" },
          params: { type: "object", description: "Path and query parameters by name", additionalProperties: true },
          body: { description: "Request body (see omada_describe_operation for the schema)" },
          files: FILES_SCHEMA,
        },
        required: ["operationId"],
      },
      annotations: cfg.readOnly
        ? { readOnlyHint: true, openWorldHint: true }
        : { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      handler: async (args) => {
        const op = findOp(args.operationId);
        const res = await executeOperation(client, cfg, spec, op, {
          params: asObject(args.params, "params"),
          body: maybeJson(args.body),
          files: asObject(args.files, "files") as Record<string, FileInput> | undefined,
        });
        return formatResponse(res, cfg.maxResponseChars);
      },
    },
    {
      name: "omada_get_schema",
      title: "Show an Omada data schema",
      description:
        'Expand a named schema from the Omada spec (used when another schema says "call omada_get_schema"). $refs are inlined.',
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Schema name, e.g. CreateSiteEntity" },
          maxDepth: { type: "integer", minimum: 1, maximum: 20, default: 6 },
        },
        required: ["name"],
      },
      annotations: READ_ONLY,
      handler: async (args) => {
        const name = str(args.name);
        if (!name || !spec.schemas[name]) {
          const needle = (name ?? "").toLowerCase();
          const similar = Object.keys(spec.schemas)
            .filter((n) => needle && n.toLowerCase().includes(needle))
            .slice(0, 20);
          throw new OmadaError(`Unknown schema "${name}".${similar.length ? ` Similar: ${similar.join(", ")}` : ""}`);
        }
        return text(JSON.stringify(spec.resolve({ $ref: `#/components/schemas/${name}` }, clampInt(args.maxDepth, 1, 20, 6)), null, 2));
      },
    },
    {
      name: "omada_status",
      title: "Omada connection status",
      description:
        "Show the server's configuration (no secrets), which spec is loaded, and test the connection by getting an access token.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, openWorldHint: true },
      handler: async () => {
        const info: Record<string, unknown> = {
          baseUrl: cfg.baseUrl ?? "(not set)",
          authMode: client.tokens.mode,
          clientId: cfg.clientId ? `${cfg.clientId.slice(0, 4)}…` : "(not set)",
          defaultSite: cfg.defaultSite ?? "(none)",
          readOnly: cfg.readOnly,
          toolMode: cfg.toolMode,
          verifySsl: cfg.verifySsl,
          spec: spec.source,
          operationsInSpec: spec.operations.length,
          operationsEnabled: ops.length,
        };
        try {
          info.omadacId = await client.getOmadacId();
          await client.tokens.getAccessToken();
          info.token = client.tokens.status();
          info.connection = "ok";
        } catch (e) {
          info.connection = `failed: ${(e as Error).message}`;
        }
        return text(JSON.stringify(info, null, 2));
      },
    },
  ];

  if (cfg.allowRawRequest) {
    tools.push({
      name: "omada_request",
      title: "Raw Omada API request",
      description:
        "Send a raw HTTP request to the controller with the access token attached, for anything not covered by the spec. Path is relative to the base URL, e.g. /openapi/v1/{omadacId}/sites; {omadacId}/{mspId} are replaced automatically and {siteId} with the default site.",
      inputSchema: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          path: { type: "string", description: 'Starts with "/", e.g. /openapi/v1/{omadacId}/sites' },
          query: { type: "object", description: "Query parameters", additionalProperties: true },
          body: { description: "JSON body" },
        },
        required: ["method", "path"],
      },
      annotations: cfg.readOnly
        ? { readOnlyHint: true, openWorldHint: true }
        : { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
      handler: async (args) => {
        const method = (str(args.method) ?? "GET").toUpperCase();
        if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new OmadaError(`Unsupported method ${method}`);
        if (cfg.readOnly && method !== "GET") throw new OmadaError(`Read-only mode (OMADA_READ_ONLY=true): ${method} is blocked.`);
        let path = str(args.path);
        if (!path) throw new OmadaError("path is required.");
        if (/\{(omadacId|mspId)\}/.test(path)) {
          const id = encodeURIComponent(await client.getOmadacId());
          path = path.replace(/\{(omadacId|mspId)\}/g, id);
        }
        if (path.includes("{siteId}")) {
          if (!cfg.defaultSite) throw new OmadaError("Path has {siteId} but OMADA_SITE is not set; put the site ID in the path.");
          path = path.replaceAll("{siteId}", encodeURIComponent(await client.resolveSiteId(cfg.defaultSite)));
        }
        const query: QueryPairs = [];
        for (const [k, v] of Object.entries(asObject(args.query, "query") ?? {})) flattenQuery(k, v, query);
        const res = await client.request({ method, path, query, json: method === "GET" ? undefined : maybeJson(args.body) });
        return formatResponse(res, cfg.maxResponseChars);
      },
    });
  }

  if (cfg.toolMode === "full") {
    const taken = new Set(tools.map((t) => t.name));
    for (const op of ops) {
      if (taken.has(op.operationId)) continue;
      taken.add(op.operationId);
      tools.push(operationTool(ctx, op));
    }
  }
  return tools;
}

// ---------------------------------------------------------------------------
// Full mode: one tool per operation

function operationTool(ctx: ToolContext, op: Operation): ToolDef {
  const { cfg, client, spec } = ctx;
  const properties: JsonSchema = {};
  const required: string[] = [];
  const reserved = new Set(["body", "files"]);

  for (const p of op.pathParams) {
    const auto = AUTO_ID_PARAMS.has(p.name) || (p.name === "siteId" && !!cfg.defaultSite);
    let description = p.description ?? p.name;
    if (AUTO_ID_PARAMS.has(p.name)) description += " (optional: filled in automatically)";
    if (p.name === "siteId") description += `. Site ID or site name${cfg.defaultSite ? ` (default: ${cfg.defaultSite})` : ""}`;
    properties[p.name] = { type: "string", description };
    if (!auto) required.push(p.name);
  }
  for (const q of op.queryParams) {
    if (reserved.has(q.name)) continue;
    const schema = q.schema ? spec.resolve(q.schema, 4) : { type: "string" };
    let description = q.description ?? schema.description ?? q.name;
    if (q.isObject) description += " (object; its fields are sent as separate query parameters)";
    if (q.required && (q.name === "page" || q.name === "pageSize")) description += ` (default ${q.name === "page" ? 1 : 100})`;
    properties[q.name] = { ...schema, description };
    if (q.required && !q.isObject && q.name !== "page" && q.name !== "pageSize") required.push(q.name);
  }
  if (op.body) {
    if (op.body.contentType.includes("multipart")) {
      const { fields, files, requiredFiles } = multipartParts(spec, op);
      if (Object.keys(fields.properties ?? {}).length) {
        properties.body = { ...fields, description: "Form fields (objects are sent as JSON parts)" };
        if (fields.required?.length) required.push("body");
      }
      properties.files = { ...FILES_SCHEMA, description: `${FILES_SCHEMA.description} File field(s): ${files.join(", ")}` };
      if (requiredFiles.length) required.push("files");
    } else {
      const schema = spec.resolve(op.body.schema);
      properties.body = { ...schema, description: schema.description ?? "Request body" };
      if (op.body.required) required.push("body");
    }
  }

  const description = [
    `${op.summary}${op.deprecated ? " [DEPRECATED]" : ""}`,
    `${op.method} ${op.path}  (category: ${op.tags.join(", ")})`,
    truncate(op.description, 1200),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    name: op.operationId,
    title: op.summary || op.operationId,
    description,
    inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) },
    annotations: {
      readOnlyHint: op.method === "GET",
      destructiveHint: op.method !== "GET",
      idempotentHint: ["GET", "PUT", "DELETE"].includes(op.method),
      openWorldHint: true,
    },
    handler: async (args) => {
      const { body, files, ...params } = args;
      const callArgs: CallArgs = {
        params,
        body: maybeJson(body),
        files: asObject(files, "files") as Record<string, FileInput> | undefined,
      };
      const res = await executeOperation(client, cfg, spec, op, callArgs);
      return formatResponse(res, cfg.maxResponseChars);
    },
  };
}

// ---------------------------------------------------------------------------
// Describe

function describe(ctx: ToolContext, op: Operation, includeResponse: boolean): string {
  const { cfg, spec } = ctx;
  const out: string[] = [];
  out.push(`operationId: ${op.operationId}${op.deprecated ? "  [DEPRECATED]" : ""}`);
  out.push(`${op.method} ${op.path}`);
  out.push(`Category: ${op.tags.join(", ")}`);
  if (op.summary) out.push(`Summary: ${op.summary}`);
  if (op.description && op.description !== op.summary) out.push("", "Description:", op.description);

  const example: Record<string, unknown> = {};
  if (op.pathParams.length) {
    out.push("", "Path parameters:");
    for (const p of op.pathParams) {
      let note = "required";
      if (AUTO_ID_PARAMS.has(p.name)) note = "auto-filled";
      else if (p.name === "siteId") {
        note = cfg.defaultSite ? `optional, default "${cfg.defaultSite}"; ID or site name` : "required; ID or site name";
      }
      out.push(`- ${p.name} (${note})${p.description ? ` — ${p.description}` : ""}`);
      if (!AUTO_ID_PARAMS.has(p.name) && !(p.name === "siteId" && cfg.defaultSite)) example[p.name] = `<${p.name}>`;
    }
  }
  if (op.queryParams.length) {
    out.push("", "Query parameters:");
    for (const q of op.queryParams) {
      const schema = q.schema ? spec.resolve(q.schema, 4) : {};
      const type = schema.type ?? "string";
      let note = q.required ? "required" : "optional";
      if (q.required && q.name === "page") note = "default 1";
      if (q.required && q.name === "pageSize") note = "default 100";
      out.push(`- ${q.name} (${type}, ${note})${q.description ? ` — ${q.description}` : ""}`);
      if (q.isObject && schema.properties) {
        out.push(`  Its fields go directly in params (sent as separate query parameters):`);
        for (const [k, v] of Object.entries<JsonSchema>(schema.properties)) {
          out.push(`  - ${k} (${v.type ?? "object"})${v.description ? ` — ${v.description}` : ""}`);
        }
      }
      if (q.required && !q.isObject && q.name !== "page" && q.name !== "pageSize") example[q.name] = `<${q.name}>`;
    }
  }

  let files: string[] = [];
  if (op.body) {
    const req = op.body.required ? "required" : "optional";
    if (op.body.contentType.includes("multipart")) {
      const parts = multipartParts(spec, op);
      files = parts.files;
      out.push("", `Request body: multipart/form-data (${req})`);
      out.push(`File field(s) — pass in "files": ${parts.files.join(", ") || "(none)"}${parts.requiredFiles.length ? ` (required: ${parts.requiredFiles.join(", ")})` : ""}`);
      if (Object.keys(parts.fields.properties ?? {}).length) {
        out.push('Other form fields — pass in "body" (objects are sent as JSON parts):', JSON.stringify(parts.fields, null, 2));
      }
    } else {
      out.push("", `Request body: ${op.body.contentType} (${req}) — JSON schema:`, JSON.stringify(spec.resolve(op.body.schema), null, 2));
    }
  }

  if (includeResponse && op.responseSchema) {
    const resolved = spec.resolve(op.responseSchema, 6);
    const result = resolved.properties?.result ?? resolved;
    out.push("", "Response `result` schema (the reply is {errorCode, msg, result}):", JSON.stringify(result, null, 2));
  }

  const call: Record<string, unknown> = { operationId: op.operationId };
  if (Object.keys(example).length) call.params = example;
  if (op.body && !op.body.contentType.includes("multipart")) call.body = "{...}";
  if (files.length) call.files = { [files[0]]: { path: "/path/to/file" } };
  out.push("", `Example: omada_call_operation ${JSON.stringify(call)}`);
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers

function opLine(op: Operation): string {
  return `${op.operationId} — ${op.method} ${op.path} — ${op.summary}${op.deprecated ? " [DEPRECATED]" : ""} [${op.tags.join(", ")}]`;
}

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Accepts an object, or a JSON string of one (some clients send nested objects as strings). */
function asObject(v: unknown, name: string): Record<string, unknown> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") {
    if (!v.trim()) return undefined;
    try {
      v = JSON.parse(v);
    } catch {
      throw new OmadaError(`"${name}" must be an object.`);
    }
  }
  if (typeof v !== "object" || Array.isArray(v)) throw new OmadaError(`"${name}" must be an object.`);
  return v as Record<string, unknown>;
}

/** Some clients send JSON bodies as strings; parse them when they look like JSON. */
function maybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

export { errorResult };
