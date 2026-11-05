/**
 * Loads the Omada OpenAPI document and builds a searchable index of operations.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import { isBinary, refName, resolveSchema, type JsonSchema } from "./schema.js";
import { log } from "./log.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export interface ParamInfo {
  name: string;
  in: "path" | "query";
  required: boolean;
  description?: string;
  schema?: JsonSchema;
  /** Query param typed as an object: Spring binds its fields as separate query keys. */
  isObject?: boolean;
}

export interface Operation {
  operationId: string;
  method: HttpMethod;
  path: string;
  tags: string[];
  summary: string;
  description: string;
  deprecated: boolean;
  pathParams: ParamInfo[];
  queryParams: ParamInfo[];
  body?: {
    contentType: string;
    required: boolean;
    schema: JsonSchema;
  };
  responseSchema?: JsonSchema;
  /** Pre-tokenised text, used for search. */
  index: { id: string[]; summary: string[]; tags: string[]; path: string[]; desc: string[] };
}

export interface SearchOptions {
  tag?: string;
  method?: string;
  limit?: number;
}

/** Fetches a JSON document from the controller; returns undefined on 404/unusable. */
export type SpecFetcher = (path: string) => Promise<unknown>;

export class ApiSpec {
  readonly operations: Operation[] = [];
  readonly tags = new Map<string, { description?: string; count: number }>();
  readonly schemas: Record<string, JsonSchema>;
  private readonly byId = new Map<string, Operation>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(readonly doc: any, readonly source: string) {
    if (!doc || typeof doc !== "object" || !doc.paths) throw new Error(`Not an OpenAPI document (${source})`);
    this.schemas = doc.components?.schemas ?? {};
    const tagDescriptions = new Map<string, string>();
    for (const t of doc.tags ?? []) if (t?.name) tagDescriptions.set(t.name, t.description);

    for (const [path, item] of Object.entries<JsonSchema>(doc.paths)) {
      const shared: JsonSchema[] = item.parameters ?? [];
      for (const method of METHODS) {
        const raw = item[method.toLowerCase()];
        if (!raw) continue;
        const op = this.buildOperation(path, method, raw, shared);
        if (this.byId.has(op.operationId.toLowerCase())) {
          // Never silently drop an operation: disambiguate duplicate IDs.
          op.operationId = `${op.operationId}_${method.toLowerCase()}`;
        }
        this.operations.push(op);
        this.byId.set(op.operationId.toLowerCase(), op);
        for (const tag of op.tags) {
          const entry = this.tags.get(tag) ?? { description: tagDescriptions.get(tag), count: 0 };
          entry.count++;
          this.tags.set(tag, entry);
        }
      }
    }
  }

  get(operationId: string): Operation | undefined {
    return this.byId.get(operationId.trim().toLowerCase());
  }

  /** Inline $refs so the schema is self-contained. */
  resolve(schema: unknown, maxDepth = 8): JsonSchema {
    return resolveSchema(this.schemas, schema, maxDepth);
  }

  private buildOperation(path: string, method: HttpMethod, raw: JsonSchema, shared: JsonSchema[]): Operation {
    const declared = new Map<string, JsonSchema>();
    for (const p of [...shared, ...(raw.parameters ?? [])]) {
      const param = p?.$ref ? this.doc.components?.parameters?.[refName(p.$ref)] : p;
      if (param?.name && param.in) declared.set(`${param.in}:${param.name}`, param);
    }

    // The spec sometimes omits path params from the parameter list, so the
    // path template is the source of truth for which path params exist.
    const pathParams: ParamInfo[] = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => {
      const name = m[1];
      const p = declared.get(`path:${name}`);
      return { name, in: "path", required: true, description: p?.description, schema: p?.schema };
    });

    const queryParams: ParamInfo[] = [];
    for (const p of declared.values()) {
      if (p.in !== "query") continue;
      const resolved = p.schema ? this.resolve(p.schema, 4) : undefined;
      queryParams.push({
        name: p.name,
        in: "query",
        required: !!p.required,
        description: p.description,
        schema: p.schema,
        isObject: resolved?.type === "object" || !!resolved?.properties,
      });
    }

    let body: Operation["body"];
    const content = raw.requestBody?.content as Record<string, JsonSchema> | undefined;
    if (content) {
      const contentType =
        Object.keys(content).find((c) => c.includes("json")) ??
        Object.keys(content).find((c) => c.includes("multipart")) ??
        Object.keys(content)[0];
      if (contentType) {
        body = { contentType, required: !!raw.requestBody.required, schema: content[contentType]?.schema ?? {} };
      }
    }

    const okResponse = raw.responses?.["200"] ?? raw.responses?.["201"] ?? raw.responses?.default;
    const responseContent = okResponse?.content as Record<string, JsonSchema> | undefined;
    const responseSchema = responseContent ? Object.values(responseContent)[0]?.schema : undefined;

    const operationId: string = raw.operationId ?? `${method.toLowerCase()}${path.replace(/[^A-Za-z0-9]+/g, "_")}`;
    const summary: string = raw.summary ?? "";
    const description = cleanHtml(raw.description ?? "");
    const tags: string[] = raw.tags?.length ? raw.tags : ["Untagged"];

    return {
      operationId,
      method,
      path,
      tags,
      summary,
      description,
      deprecated: !!raw.deprecated,
      pathParams,
      queryParams,
      body,
      responseSchema,
      index: {
        id: words(splitCamel(operationId)),
        summary: words(summary),
        tags: words(tags.join(" ")),
        path: words(path.replace(/\{[^}]+\}/g, " ")),
        desc: words(description.slice(0, 600)),
      },
    };
  }

  /**
   * Keyword search over operationId, summary, tags, path and description.
   * All query words must match (prefix match, so "client" finds "clients");
   * if nothing matches every word, falls back to best partial matches.
   */
  search(query: string, opts: SearchOptions = {}, pool: Operation[] = this.operations): Operation[] {
    const limit = opts.limit ?? 20;
    const method = opts.method?.toUpperCase();
    const tag = opts.tag?.toLowerCase();
    const candidates = pool.filter(
      (op) =>
        (!method || op.method === method) &&
        (!tag || op.tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().includes(tag))),
    );
    const terms = words(query).map(expandTerm);
    if (!terms.length) return candidates.slice(0, limit);

    const score = (op: Operation, requireAll: boolean): number => {
      let total = 0;
      let strong = 0; // terms found in the operationId or summary
      for (const alternatives of terms) {
        let best = 0;
        let inTitle = false;
        for (const { term, factor } of alternatives) {
          const title = Math.max(fieldScore(op.index.id, term, 3), fieldScore(op.index.summary, term, 3)) * factor;
          if (title > 0) inTitle = true;
          best = Math.max(
            best,
            title,
            fieldScore(op.index.tags, term, 2) * factor,
            fieldScore(op.index.path, term, 2) * factor,
            fieldScore(op.index.desc, term, 1) * factor,
          );
        }
        if (best === 0 && requireAll) return 0;
        total += best;
        if (inTitle) strong++;
      }
      if (strong === terms.length) total += 2;
      // Prefer summaries made mostly of the query words ("Get client list" over "Export global client list").
      const summary = op.index.summary;
      if (summary.length) {
        const covered = summary.filter((w) => terms.some((alts) => alts.some((a) => w.startsWith(a.term)))).length;
        total += (2 * covered) / summary.length;
      }
      if (op.deprecated) total -= 0.5;
      return total;
    };

    for (const requireAll of [true, false]) {
      const hits = candidates
        .map((op) => ({ op, s: score(op, requireAll) }))
        .filter((h) => h.s > 0)
        .sort((a, b) => b.s - a.s || a.op.path.length - b.op.path.length);
      if (hits.length) return hits.slice(0, limit).map((h) => h.op);
    }
    return [];
  }
}

function fieldScore(tokens: string[], term: string, weight: number): number {
  let best = 0;
  for (const t of tokens) {
    if (t === term) return weight + 1;
    if (t.startsWith(term)) best = weight;
  }
  return best;
}

const SYNONYMS: Record<string, string[]> = {
  wifi: ["wlan", "ssid", "wireless"],
  wireless: ["wlan", "ssid", "wifi"],
  ssid: ["ssid", "wlan"],
  wlan: ["wlan", "ssid"],
  ap: ["ap", "eap"],
  router: ["gateway", "osg"],
  gateway: ["gateway", "osg"],
  switch: ["switch", "osw"],
  station: ["client"],
  user: ["user", "client"],
  remove: ["delete", "remove"],
  delete: ["delete", "remove"],
  update: ["modify", "update", "edit"],
  edit: ["modify", "edit", "update"],
  change: ["modify", "update", "change"],
  set: ["modify", "set", "update"],
  add: ["create", "add"],
  create: ["create", "add"],
  list: ["list", "get", "query"],
  show: ["get", "list", "query"],
  firmware: ["firmware", "upgrade"],
  reboot: ["reboot", "restart"],
  restart: ["reboot", "restart"],
  password: ["password", "psk", "passphrase", "key"],
  forward: ["forwarding", "forward", "nat"],
};

interface Alt {
  term: string;
  factor: number;
}

/** The word itself and its singular forms count fully; synonyms count a bit less. */
function expandTerm(word: string): Alt[] {
  const alts: Alt[] = [{ term: word, factor: 1 }];
  if (word.length > 3 && word.endsWith("s")) alts.push({ term: word.slice(0, -1), factor: 1 });
  if (word.length > 4 && word.endsWith("es")) alts.push({ term: word.slice(0, -2), factor: 1 });
  for (const syn of SYNONYMS[word] ?? []) if (syn !== word) alts.push({ term: syn, factor: 0.7 });
  return alts;
}

function splitCamel(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function cleanHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Multipart operations: split body schema into JSON fields and binary file fields. */
export function multipartParts(spec: ApiSpec, op: Operation): { fields: JsonSchema; files: string[]; requiredFiles: string[] } {
  const schema = spec.resolve(op.body?.schema ?? {});
  const props: JsonSchema = schema.properties ?? {};
  const required: string[] = schema.required ?? [];
  const fields: JsonSchema = { type: "object", properties: {} as JsonSchema, required: [] as string[] };
  const files: string[] = [];
  for (const [name, s] of Object.entries(props)) {
    if (isBinary(s as JsonSchema)) files.push(name);
    else {
      fields.properties[name] = s;
      if (required.includes(name)) fields.required.push(name);
    }
  }
  if (!fields.required.length) delete fields.required;
  return { fields, files, requiredFiles: files.filter((f) => required.includes(f)) };
}

// ---------------------------------------------------------------------------
// Loading

const BUNDLED_SPEC = fileURLToPath(new URL("../spec/omada-openapi.json", import.meta.url));

async function readSpecFile(path: string, label: string): Promise<ApiSpec> {
  const text = await readFile(path, "utf8");
  return new ApiSpec(JSON.parse(text), label);
}

/** Fetch the spec the controller itself serves, so it matches its firmware version. */
async function fetchLiveSpec(fetcher: SpecFetcher, baseUrl: string): Promise<ApiSpec> {
  const isSpec = (d: unknown): d is JsonSchema => !!d && typeof d === "object" && "paths" in (d as object);

  const all = await fetcher("/v3/api-docs/00%20All");
  if (isSpec(all)) return new ApiSpec(all, `live: ${baseUrl}/v3/api-docs/00 All`);

  // Spec split into groups: find them via swagger-config and merge.
  const config = (await fetcher("/v3/api-docs/swagger-config")) as JsonSchema | undefined;
  const urls: { name?: string; url?: string }[] = Array.isArray(config?.urls) ? config!.urls : [];
  if (urls.length) {
    const allGroup = urls.find((u) => /\ball\b/i.test(u.name ?? ""));
    const groups = allGroup ? [allGroup] : urls;
    const merged: JsonSchema = { openapi: "3.0.1", info: {}, paths: {}, components: { schemas: {} }, tags: [] };
    for (const g of groups) {
      if (!g.url) continue;
      const doc = await fetcher(g.url.startsWith("/") ? g.url : `/${g.url}`);
      if (!isSpec(doc)) continue;
      merged.info = doc.info ?? merged.info;
      Object.assign(merged.paths, doc.paths);
      Object.assign(merged.components.schemas, doc.components?.schemas ?? {});
      merged.tags.push(...(doc.tags ?? []));
    }
    if (Object.keys(merged.paths).length) return new ApiSpec(merged, `live: ${baseUrl} (${groups.length} group(s))`);
  }

  const plain = await fetcher("/v3/api-docs");
  if (isSpec(plain)) return new ApiSpec(plain, `live: ${baseUrl}/v3/api-docs`);
  throw new Error("controller did not return an OpenAPI document");
}

export async function loadSpec(cfg: Config, fetcher: SpecFetcher): Promise<ApiSpec> {
  const mode = cfg.spec;
  if (mode === "bundled") return readSpecFile(BUNDLED_SPEC, "bundled");
  if (mode !== "auto" && mode !== "live") return readSpecFile(mode, `file: ${mode}`);

  if (!cfg.baseUrl) {
    if (mode === "live") throw new Error("OMADA_SPEC=live needs OMADA_BASE_URL");
    return readSpecFile(BUNDLED_SPEC, "bundled");
  }
  try {
    return await fetchLiveSpec(fetcher, cfg.baseUrl);
  } catch (e) {
    if (mode === "live") throw new Error(`Could not load the live spec from ${cfg.baseUrl}: ${(e as Error).message}`);
    log(`Live spec unavailable (${(e as Error).message}); using the bundled spec.`);
    return readSpecFile(BUNDLED_SPEC, "bundled (live spec unavailable)");
  }
}
