/**
 * Minimal fake Omada controller for tests: auth endpoints, /api/info,
 * site list, spec serving, and an echo for every other /openapi path.
 */
import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const OMADAC_ID = "mock-omadac";
export const SITE_ID = "640effd1b3f2ae5b912275ec";
export const CLIENT_ID = "cid";
export const CLIENT_SECRET = "secret";

export interface Recorded {
  method: string;
  path: string;
  query: [string, string][];
  headers: IncomingMessage["headers"];
  body?: unknown;
  parts?: { name: string; type?: string; filename?: string; value: string }[];
}

export interface MockState {
  grants: string[];
  requests: Recorded[];
  /** Next API call answers -44112 (token expired). */
  expireNext: boolean;
  currentToken?: string;
}

const SPEC_PATH = fileURLToPath(new URL("../spec/omada-openapi.json", import.meta.url));

export async function startMock(): Promise<{ url: string; state: MockState; close: () => Promise<void> }> {
  const state: MockState = { grants: [], requests: [], expireNext: false };
  let counter = 0;
  const issue = () => {
    counter++;
    state.currentToken = `AT-${counter}`;
    return { errorCode: 0, msg: "ok", result: { accessToken: state.currentToken, tokenType: "bearer", expiresIn: 7200, refreshToken: `RT-${counter}` } };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const ct = req.headers["content-type"] ?? "";
    let body: unknown;
    let parts: Recorded["parts"];
    if (ct.includes("application/json") && raw.length) body = JSON.parse(raw.toString());
    if (ct.includes("multipart/form-data")) {
      const fd = await new Request("http://x", { method: "POST", headers: { "content-type": ct }, body: raw }).formData();
      parts = [];
      for (const [name, v] of fd.entries()) {
        if (typeof v === "string") parts.push({ name, value: v });
        else parts.push({ name, type: v.type, filename: (v as File).name, value: await v.text() });
      }
    }
    const send = (obj: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(obj));
    };
    const q = url.searchParams;
    const b = (body ?? {}) as Record<string, string>;

    if (url.pathname === "/api/info") return send({ errorCode: 0, result: { omadacId: OMADAC_ID, controllerVer: "5.15.0" } });

    if (url.pathname === "/v3/api-docs/00 All" || url.pathname === "/v3/api-docs/00%20All") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(readFileSync(SPEC_PATH));
      return;
    }

    if (url.pathname === "/openapi/authorize/login") {
      if (q.get("client_id") === CLIENT_ID && q.get("omadac_id") === OMADAC_ID && b.username === "admin" && b.password === "pw") {
        return send({ errorCode: 0, result: { csrfToken: "csrf", sessionId: "sess" } });
      }
      return send({ errorCode: -44116, msg: "bad login" });
    }
    if (url.pathname === "/openapi/authorize/code") {
      if (req.headers["csrf-token"] === "csrf" && req.headers.cookie === "TPOMADA_SESSIONID=sess" && q.get("response_type") === "code") {
        return send({ errorCode: 0, result: "OC-1" });
      }
      return send({ errorCode: -44108, msg: "bad csrf" });
    }
    if (url.pathname === "/openapi/authorize/token") {
      const grant = q.get("grant_type") ?? "";
      state.grants.push(grant);
      if (grant === "client_credentials" && b.client_id === CLIENT_ID && b.client_secret === CLIENT_SECRET && b.omadacId === OMADAC_ID) return send(issue());
      if (grant === "refresh_token" && q.get("refresh_token")?.startsWith("RT-") && q.get("client_id") === CLIENT_ID) return send(issue());
      if (grant === "authorization_code" && q.get("code") === "OC-1" && b.client_id === CLIENT_ID && b.client_secret === CLIENT_SECRET) return send(issue());
      return send({ errorCode: -44106, msg: "The client id or client secret is invalid." });
    }

    if (url.pathname.startsWith("/openapi/")) {
      if (req.headers.authorization !== `AccessToken=${state.currentToken}`) return send({ errorCode: -44113, msg: "The access token is Invalid" });
      if (state.expireNext) {
        state.expireNext = false;
        return send({ errorCode: -44112, msg: "The access token has expired." });
      }
      state.requests.push({ method: req.method ?? "", path: url.pathname, query: [...q.entries()], headers: req.headers, body, parts });
      if (url.pathname === `/openapi/v1/${OMADAC_ID}/sites` && req.method === "GET") {
        return send({ errorCode: 0, msg: "Success.", result: { totalRows: 2, currentPage: 1, currentSize: 2, data: [{ siteId: SITE_ID, name: "Home" }, { siteId: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Office" }] } });
      }
      if (url.pathname.endsWith("/forbidden")) return send({ errorCode: -1005, msg: "Operation forbidden." });
      return send({ errorCode: 0, msg: "Success.", result: { method: req.method, path: url.pathname, query: [...q.entries()], body, parts } });
    }
    send({ error: "not found" }, 404);
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
