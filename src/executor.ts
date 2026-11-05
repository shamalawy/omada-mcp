/**
 * Runs one Open API operation: fills path params, builds the query string,
 * encodes the body (JSON or multipart), and formats the reply for MCP.
 */
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { FormData } from "undici";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OmadaClient, QueryPairs, RawResponse } from "./client.js";
import type { Config } from "./config.js";
import { ERROR_HINTS, OmadaError } from "./errors.js";
import { multipartParts, type ApiSpec, type Operation } from "./spec.js";

export interface FileInput {
  /** Path to a local file to upload. */
  path?: string;
  /** File content as base64. */
  base64?: string;
  /** File content as plain text. */
  text?: string;
  filename?: string;
  contentType?: string;
}

export interface CallArgs {
  /** Path and query parameters by name. Unknown names are sent as query parameters. */
  params?: Record<string, unknown>;
  body?: unknown;
  files?: Record<string, FileInput>;
}

/** IDs filled in from configuration when not given. */
export const AUTO_ID_PARAMS = new Set(["omadacId", "mspId"]);
const DEFAULT_PAGE_SIZE = 100;

export async function executeOperation(
  client: OmadaClient,
  cfg: Config,
  spec: ApiSpec,
  op: Operation,
  args: CallArgs,
): Promise<RawResponse> {
  if (cfg.readOnly && op.method !== "GET") {
    throw new OmadaError(`Read-only mode (OMADA_READ_ONLY=true): ${op.method} ${op.operationId} is blocked.`);
  }
  const params: Record<string, unknown> = { ...(args.params ?? {}) };
  const missing: string[] = [];

  // Path parameters
  let path = op.path;
  for (const p of op.pathParams) {
    let value = params[p.name];
    delete params[p.name];
    if (isEmpty(value)) {
      if (AUTO_ID_PARAMS.has(p.name)) value = await client.getOmadacId();
      else if (p.name === "siteId" && cfg.defaultSite) value = cfg.defaultSite;
      else {
        missing.push(p.name);
        continue;
      }
    }
    if (p.name === "siteId") value = await client.resolveSiteId(String(value));
    path = path.replace(`{${p.name}}`, encodeURIComponent(String(value)));
  }

  // Query parameters
  const query: QueryPairs = [];
  for (const q of op.queryParams) {
    let value = params[q.name];
    delete params[q.name];
    if (isEmpty(value)) {
      if (q.required && q.name === "page") value = 1;
      else if (q.required && q.name === "pageSize") value = DEFAULT_PAGE_SIZE;
      else if (q.required && !q.isObject) {
        missing.push(q.name);
        continue;
      } else continue;
    }
    // Object-typed query params are bound field-by-field (no prefix).
    if (q.isObject && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) flattenQuery(k, v, query);
    } else flattenQuery(q.name, value, query);
  }
  // Anything left over: send as query (the spec is not always complete).
  for (const [k, v] of Object.entries(params)) flattenQuery(k, v, query);

  if (missing.length) {
    throw new OmadaError(
      `Missing required parameter(s) for ${op.operationId}: ${missing.join(", ")}. Use omada_describe_operation to see all parameters.`,
    );
  }

  // Body
  if (op.body?.contentType.includes("multipart")) {
    const form = await buildMultipart(spec, op, args);
    return client.request({ method: op.method, path, query, form });
  }
  if (op.body?.required && args.body === undefined) {
    throw new OmadaError(`${op.operationId} needs a request body. Use omada_describe_operation to see its schema.`);
  }
  const json = op.method === "GET" ? undefined : args.body;
  return client.request({ method: op.method, path, query, json });
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

/** form/explode serialisation as Spring binds it: arrays repeat, objects use dots, object arrays use [i]. */
export function flattenQuery(name: string, value: unknown, out: QueryPairs): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (item && typeof item === "object") flattenQuery(`${name}[${i}]`, item, out);
      else flattenQuery(name, item, out);
    });
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flattenQuery(`${name}.${k}`, v, out);
  } else {
    out.push([name, String(value)]);
  }
}

const MIME: Record<string, string> = {
  ".json": "application/json",
  ".txt": "text/plain",
  ".conf": "text/plain",
  ".ovpn": "application/x-openvpn-profile",
  ".pem": "application/x-pem-file",
  ".crt": "application/x-x509-ca-cert",
  ".cer": "application/x-x509-ca-cert",
  ".key": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".zip": "application/zip",
  ".bin": "application/octet-stream",
};

async function buildMultipart(spec: ApiSpec, op: Operation, args: CallArgs): Promise<FormData> {
  const { files: fileFields, requiredFiles } = multipartParts(spec, op);
  const form = new FormData();

  const body = args.body;
  if (body !== undefined && (typeof body !== "object" || body === null || Array.isArray(body))) {
    throw new OmadaError(`${op.operationId} is a multipart upload: "body" must be an object of form fields.`);
  }
  for (const [name, value] of Object.entries((body as Record<string, unknown>) ?? {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object") {
      // JSON parts (e.g. "config") must be sent as application/json.
      form.append(name, new Blob([JSON.stringify(value)], { type: "application/json" }), `${name}.json`);
    } else form.append(name, String(value));
  }

  const files = args.files ?? {};
  const absent = requiredFiles.filter((f) => !files[f]);
  if (absent.length) {
    throw new OmadaError(
      `${op.operationId} needs file(s): ${absent.join(", ")}. Pass them in "files", e.g. {"${absent[0]}": {"path": "/path/to/file"}}.`,
    );
  }
  for (const [name, f] of Object.entries(files)) {
    if (!fileFields.includes(name) && fileFields.length) {
      throw new OmadaError(`${op.operationId} has no file field "${name}". File fields: ${fileFields.join(", ")}`);
    }
    let data: Buffer;
    if (f.path) data = await readFile(f.path);
    else if (f.base64 !== undefined) data = Buffer.from(f.base64, "base64");
    else if (f.text !== undefined) data = Buffer.from(f.text, "utf8");
    else throw new OmadaError(`File "${name}" needs one of: path, base64, text.`);
    const filename = f.filename ?? (f.path ? basename(f.path) : name);
    const type = f.contentType ?? MIME[extname(filename).toLowerCase()] ?? "application/octet-stream";
    form.append(name, new Blob([new Uint8Array(data)], { type }), filename);
  }
  return form;
}

// ---------------------------------------------------------------------------
// Formatting

export function formatResponse(res: RawResponse, maxChars: number): CallToolResult {
  const data = res.data as { errorCode?: unknown; msg?: unknown } | string | undefined;
  const errorCode = data && typeof data === "object" && typeof data.errorCode === "number" ? data.errorCode : undefined;
  const isError = res.status >= 400 || (errorCode !== undefined && errorCode !== 0);

  let text: string;
  if (typeof data === "string") text = data || `(empty response, HTTP ${res.status})`;
  else {
    text = JSON.stringify(data, null, 2);
    if (text.length > maxChars / 2) text = JSON.stringify(data);
  }
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n… [truncated ${text.length - maxChars} characters. Narrow the result with page/pageSize, searchKey or filters.]`;
  }

  if (isError) {
    const lines = [`Omada request failed (HTTP ${res.status}${errorCode !== undefined ? `, errorCode ${errorCode}` : ""}).`];
    if (errorCode !== undefined && ERROR_HINTS[errorCode]) lines.push(`Hint: ${ERROR_HINTS[errorCode]}`);
    if (res.status === 429) lines.push("Hint: API rate limit exceeded; wait and retry.");
    lines.push(text);
    text = lines.join("\n");
  }
  return { content: [{ type: "text", text }], isError };
}

export function errorResult(e: unknown): CallToolResult {
  const err = e as OmadaError;
  let text = err?.message ?? String(e);
  if (err instanceof OmadaError && err.errorCode !== undefined && ERROR_HINTS[err.errorCode]) {
    text += `\nHint: ${ERROR_HINTS[err.errorCode]}`;
  }
  return { content: [{ type: "text", text }], isError: true };
}
