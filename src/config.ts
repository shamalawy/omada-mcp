/**
 * Configuration, read from environment variables.
 * Every variable is documented in README.md and .env.example.
 */

export type ToolMode = "meta" | "full";
export type Transport = "stdio" | "http";

export interface Config {
  /** Controller / northbound base URL, e.g. https://192.168.0.10:8043 (no trailing slash). */
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  /** Omada ID (omadacId). For MSP apps this is the MSP ID. Auto-discovered from /api/info if unset. */
  omadacId?: string;
  /** If set (with password), use authorization-code mode instead of client-credentials mode. */
  username?: string;
  password?: string;
  /** Default site (ID or name) used when an operation needs {siteId} and none is given. */
  defaultSite?: string;
  verifySsl: boolean;
  timeoutMs: number;
  toolMode: ToolMode;
  includeTags?: string[];
  excludeTags?: string[];
  includeOperations?: RegExp;
  excludeOperations?: RegExp;
  excludeDeprecated: boolean;
  readOnly: boolean;
  /** Expose the omada_request tool (raw HTTP; not limited by the tag/operation filters). */
  allowRawRequest: boolean;
  /** "auto" (live, fall back to bundled), "live", "bundled", or a path to a spec JSON file. */
  spec: string;
  maxResponseChars: number;
  transport: Transport;
  httpHost: string;
  httpPort: number;
  httpToken?: string;
}

function str(name: string, ...aliases: string[]): string | undefined {
  for (const n of [name, ...aliases]) {
    const v = process.env[n];
    if (v !== undefined && v.trim() !== "") return v.trim();
  }
  return undefined;
}

function bool(name: string, def: boolean): boolean {
  const v = str(name);
  if (v === undefined) return def;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|no|off)$/i.test(v)) return false;
  throw new Error(`${name} must be true or false, got "${v}"`);
}

function int(name: string, def: number): number {
  const v = str(name);
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${v}"`);
  return n;
}

function list(name: string): string[] | undefined {
  const v = str(name);
  if (!v) return undefined;
  const items = v.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function regex(name: string): RegExp | undefined {
  const v = str(name);
  if (!v) return undefined;
  try {
    return new RegExp(v, "i");
  } catch (e) {
    throw new Error(`${name} is not a valid regular expression: ${(e as Error).message}`);
  }
}

export function loadConfig(): Config {
  const toolMode = (str("OMADA_TOOL_MODE") ?? "meta").toLowerCase();
  if (toolMode !== "meta" && toolMode !== "full") {
    throw new Error(`OMADA_TOOL_MODE must be "meta" or "full", got "${toolMode}"`);
  }
  const transport = (str("MCP_TRANSPORT") ?? "stdio").toLowerCase();
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(`MCP_TRANSPORT must be "stdio" or "http", got "${transport}"`);
  }
  const baseUrl = str("OMADA_BASE_URL", "OMADA_URL")?.replace(/\/+$/, "");
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    throw new Error(`OMADA_BASE_URL must start with http:// or https://, got "${baseUrl}"`);
  }
  return {
    baseUrl,
    clientId: str("OMADA_CLIENT_ID"),
    clientSecret: str("OMADA_CLIENT_SECRET"),
    omadacId: str("OMADA_ID", "OMADA_OMADAC_ID", "OMADAC_ID"),
    username: str("OMADA_USERNAME"),
    password: str("OMADA_PASSWORD"),
    defaultSite: str("OMADA_SITE", "OMADA_SITE_ID"),
    verifySsl: bool("OMADA_VERIFY_SSL", true),
    timeoutMs: int("OMADA_TIMEOUT_MS", 30000),
    toolMode,
    includeTags: list("OMADA_INCLUDE_TAGS"),
    excludeTags: list("OMADA_EXCLUDE_TAGS"),
    includeOperations: regex("OMADA_INCLUDE_OPERATIONS"),
    excludeOperations: regex("OMADA_EXCLUDE_OPERATIONS"),
    excludeDeprecated: bool("OMADA_EXCLUDE_DEPRECATED", false),
    readOnly: bool("OMADA_READ_ONLY", false),
    allowRawRequest: bool("OMADA_ALLOW_RAW_REQUEST", true),
    spec: str("OMADA_SPEC") ?? "auto",
    maxResponseChars: int("OMADA_MAX_RESPONSE_CHARS", 100000),
    transport,
    httpHost: str("MCP_HTTP_HOST") ?? "127.0.0.1",
    httpPort: int("MCP_HTTP_PORT", 3000),
    httpToken: str("MCP_HTTP_TOKEN"),
  };
}
