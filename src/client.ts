/**
 * HTTP client for the Omada controller: TLS options, timeouts, auth header,
 * automatic token renewal, omadacId discovery and site-name lookup.
 */
import { Agent, fetch, type FormData } from "undici";
import type { Config } from "./config.js";
import { TokenManager } from "./auth.js";
import { OmadaError, TOKEN_ERROR_CODES } from "./errors.js";

export type QueryPairs = [string, string][];

export interface RequestOptions {
  method: string;
  /** Path relative to the base URL, starting with "/". */
  path: string;
  query?: QueryPairs;
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  /** Send the access token (default true). */
  auth?: boolean;
  timeoutMs?: number;
}

export interface RawResponse {
  status: number;
  contentType: string;
  data: unknown;
}

export interface Site {
  siteId: string;
  name: string;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const SITE_CACHE_MS = 5 * 60_000;

export class OmadaClient {
  readonly tokens: TokenManager;
  private readonly dispatcher: Agent;
  private omadacId?: Promise<string>;
  private siteCache?: { at: number; sites: Site[] };

  constructor(readonly cfg: Config) {
    this.dispatcher = new Agent({ connect: { rejectUnauthorized: cfg.verifySsl } });
    this.tokens = new TokenManager(cfg, this);
  }

  baseUrl(): string {
    if (!this.cfg.baseUrl) {
      throw new OmadaError(
        "OMADA_BASE_URL is not set. Use the 'Interface Access Address' shown for your Open API app, e.g. https://192.168.0.10:8043",
      );
    }
    return this.cfg.baseUrl;
  }

  /** The Omada ID: from OMADA_ID, or discovered from the controller's /api/info. */
  getOmadacId(): Promise<string> {
    if (this.cfg.omadacId) return Promise.resolve(this.cfg.omadacId);
    this.omadacId ??= (async () => {
      const res = await this.request({ method: "GET", path: "/api/info", auth: false });
      const id = (res.data as { result?: { omadacId?: string } } | undefined)?.result?.omadacId;
      if (!id) {
        throw new OmadaError(
          "OMADA_ID is not set and could not be read from the controller's /api/info. Set OMADA_ID to the Omada ID shown for your Open API app.",
        );
      }
      return id;
    })().catch((e) => {
      this.omadacId = undefined; // retry on the next call
      throw e;
    });
    return this.omadacId;
  }

  async request(opts: RequestOptions): Promise<RawResponse> {
    if (!opts.path.startsWith("/") || opts.path.startsWith("//")) {
      throw new OmadaError(`Path must start with a single "/": ${opts.path}`);
    }
    const url = new URL(this.baseUrl() + opts.path);
    if (url.origin !== new URL(this.baseUrl()).origin) throw new OmadaError(`Path leaves the controller: ${opts.path}`);
    for (const [k, v] of opts.query ?? []) url.searchParams.append(k, v);

    const useAuth = opts.auth !== false;
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
      if (useAuth) headers.Authorization = `AccessToken=${await this.tokens.getAccessToken()}`;
      let body: string | FormData | undefined;
      if (opts.form) body = opts.form;
      else if (opts.json !== undefined) {
        body = JSON.stringify(opts.json);
        headers["Content-Type"] = "application/json";
      }

      const res = await this.send(url, opts.method, headers, body, opts.timeoutMs);
      if (useAuth && attempt === 0 && isTokenError(res)) {
        this.tokens.invalidate();
        continue;
      }
      return res;
    }
  }

  private async send(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body: string | FormData | undefined,
    timeoutMs = this.cfg.timeoutMs,
  ): Promise<RawResponse> {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body,
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw networkError(e, url, timeoutMs);
    }
    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // not JSON: keep the text
      }
    }
    return { status: res.status, contentType, data };
  }

  /** All sites visible to the app (cached for a few minutes). */
  async listSites(force = false): Promise<Site[]> {
    if (!force && this.siteCache && Date.now() - this.siteCache.at < SITE_CACHE_MS) return this.siteCache.sites;
    const omadacId = await this.getOmadacId();
    const sites: Site[] = [];
    for (let page = 1; page <= 100; page++) {
      const res = await this.request({
        method: "GET",
        path: `/openapi/v1/${encodeURIComponent(omadacId)}/sites`,
        query: [
          ["page", String(page)],
          ["pageSize", "1000"],
        ],
      });
      const data = res.data as { errorCode?: number; msg?: string; result?: { data?: Site[]; totalRows?: number } };
      if (data?.errorCode !== 0) {
        throw new OmadaError(`Could not list sites: ${data?.msg ?? `HTTP ${res.status}`}`, data?.errorCode, res.status, data);
      }
      const batch = data.result?.data ?? [];
      sites.push(...batch.map((s) => ({ siteId: s.siteId, name: s.name })));
      if (!batch.length || sites.length >= (data.result?.totalRows ?? 0)) break;
    }
    this.siteCache = { at: Date.now(), sites };
    return sites;
  }

  /** Accepts a site ID or a site name; returns the site ID. */
  async resolveSiteId(value: string): Promise<string> {
    const v = value.trim();
    if (OBJECT_ID.test(v)) return v;
    for (const force of [false, true]) {
      const sites = await this.listSites(force);
      const match =
        sites.find((s) => s.siteId === v) ??
        sites.find((s) => s.name === v) ??
        sites.find((s) => s.name?.toLowerCase() === v.toLowerCase());
      if (match) return match.siteId;
    }
    const names = (await this.listSites()).map((s) => s.name).slice(0, 50);
    throw new OmadaError(`No site named "${v}". Sites: ${names.join(", ") || "(none)"}`);
  }
}

function isTokenError(res: RawResponse): boolean {
  if (res.status === 401) return true;
  const code = (res.data as { errorCode?: unknown } | undefined)?.errorCode;
  return typeof code === "number" && TOKEN_ERROR_CODES.has(code);
}

function networkError(e: unknown, url: URL, timeoutMs: number): OmadaError {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return new OmadaError(`Request to ${url.origin}${url.pathname} timed out after ${timeoutMs} ms`);
  }
  const code = err?.cause?.code ?? "";
  const detail = err?.cause?.message ?? err?.message ?? String(e);
  let hint = "";
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(code + detail)) {
    hint = " The controller's TLS certificate is not trusted; set OMADA_VERIFY_SSL=false for a self-signed certificate.";
  } else if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT/.test(code)) {
    hint = " Check OMADA_BASE_URL (host and port).";
  }
  return new OmadaError(`Cannot reach ${url.origin}: ${detail}${code ? ` [${code}]` : ""}.${hint}`);
}
