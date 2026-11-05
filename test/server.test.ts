import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OmadaClient } from "../src/client.js";
import type { Config } from "../src/config.js";
import { startHttp } from "../src/http.js";
import { AppContext, createMcpServer } from "../src/server.js";
import { loadSpec, type ApiSpec } from "../src/spec.js";
import { CLIENT_ID, CLIENT_SECRET, OMADAC_ID, SITE_ID, startMock, type MockState } from "./mock-controller.js";

let mock: Awaited<ReturnType<typeof startMock>>;
let state: MockState;
let bundled: ApiSpec;

function config(over: Partial<Config> = {}): Config {
  return {
    baseUrl: mock.url,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    verifySsl: true,
    timeoutMs: 10000,
    toolMode: "meta",
    excludeDeprecated: false,
    readOnly: false,
    allowRawRequest: true,
    spec: "bundled",
    maxResponseChars: 100000,
    transport: "stdio",
    httpHost: "127.0.0.1",
    httpPort: 0,
    ...over,
  };
}

async function connect(over: Partial<Config> = {}, spec?: Promise<ApiSpec>) {
  const cfg = config(over);
  const client = new OmadaClient(cfg);
  const ctx = new AppContext(cfg, client, spec ?? Promise.resolve(bundled));
  const server = createMcpServer(ctx);
  const mcp = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), mcp.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await mcp.callTool({ name, arguments: args })) as CallToolResult;
  return { mcp, call, cfg };
}

const textOf = (r: CallToolResult) => (r.content[0] as { text: string }).text;
const jsonOf = (r: CallToolResult) => JSON.parse(textOf(r));
const lastRequest = () => state.requests[state.requests.length - 1];

before(async () => {
  mock = await startMock();
  state = mock.state;
  bundled = await loadSpec(config({ spec: "bundled" }), async () => undefined);
});
after(async () => {
  await mock.close();
});

describe("spec", () => {
  test("bundled spec loads every operation", () => {
    assert.ok(bundled.operations.length >= 2400, `only ${bundled.operations.length} operations`);
    assert.ok(bundled.get("getSiteList"));
  });

  test("path params missing from the parameter list are still found", () => {
    for (const op of bundled.operations) {
      const inPath = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      assert.deepEqual(op.pathParams.map((p) => p.name), inPath, op.operationId);
    }
  });

  test("live spec is fetched from the controller", async () => {
    const cfg = config({ spec: "live" });
    const client = new OmadaClient(cfg);
    const spec = await loadSpec(cfg, async (path) => {
      const res = await client.request({ method: "GET", path, auth: false });
      return res.status === 200 ? res.data : undefined;
    });
    assert.match(spec.source, /^live/);
    assert.equal(spec.operations.length, bundled.operations.length);
  });
});

describe("meta tools", () => {
  test("lists the meta tools only", async () => {
    const { mcp } = await connect();
    const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "omada_call_operation",
      "omada_describe_operation",
      "omada_get_schema",
      "omada_list_tags",
      "omada_request",
      "omada_search_operations",
      "omada_status",
    ]);
  });

  test("search finds the site list", async () => {
    const { call } = await connect();
    const r = await call("omada_search_operations", { query: "list sites", limit: 3 });
    assert.match(textOf(r).split("\n")[0], /^getSiteList /);
  });

  test("describe shows params and an example", async () => {
    const { call } = await connect();
    const t = textOf(await call("omada_describe_operation", { operationId: "getapvlanconfigv2" }));
    assert.match(t, /GET \/openapi\/v2\/\{omadacId\}\/sites\/\{siteId\}\/aps\/\{apMac\}\/vlan/);
    assert.match(t, /omadacId \(auto-filled\)/);
    assert.match(t, /apMac \(required\)/);
    assert.match(t, /Example: omada_call_operation/);
  });

  test("describe shows multipart file fields", async () => {
    const { call } = await connect();
    const t = textOf(await call("omada_describe_operation", { operationId: "createGoogleLdapProfile" }));
    assert.match(t, /File field\(s\) — pass in "files": file/);
    assert.match(t, /"config"/);
  });

  test("get_schema expands a schema", async () => {
    const { call } = await connect();
    const r = await call("omada_get_schema", { name: "CreateGoogleLdapProfileOpenApiVO" });
    assert.equal(r.isError, undefined);
    assert.ok(jsonOf(r).properties);
  });

  test("list_tags", async () => {
    const { call } = await connect();
    assert.match(textOf(await call("omada_list_tags", { filter: "site" })), /^Site \(\d+\)/m);
  });

  test("unknown operation suggests close matches", async () => {
    const { call } = await connect();
    const r = await call("omada_call_operation", { operationId: "getSiteLst" });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /Unknown operationId/);
  });
});

describe("calling operations", () => {
  test("client-credentials login, omadacId discovery, default paging", async () => {
    state.grants.length = 0;
    const { call } = await connect();
    const r = await call("omada_call_operation", { operationId: "getSiteList" });
    assert.equal(r.isError, false);
    assert.equal(jsonOf(r).result.data[0].name, "Home");
    assert.deepEqual(state.grants, ["client_credentials"]);
    const req = lastRequest();
    assert.equal(req.headers.authorization, `AccessToken=${state.currentToken}`);
    assert.deepEqual(req.query, [
      ["page", "1"],
      ["pageSize", "100"],
    ]);
  });

  test("siteId accepts a site name", async () => {
    const { call } = await connect();
    const r = await call("omada_call_operation", {
      operationId: "getApVlanConfigV2",
      params: { siteId: "home", apMac: "AA-BB-CC-DD-EE-FF" },
    });
    assert.equal(r.isError, false);
    assert.equal(jsonOf(r).result.path, `/openapi/v2/${OMADAC_ID}/sites/${SITE_ID}/aps/AA-BB-CC-DD-EE-FF/vlan`);
  });

  test("default site is used when siteId is omitted", async () => {
    const { call } = await connect({ defaultSite: "Office" });
    const r = await call("omada_call_operation", { operationId: "getApVlanConfigV2", params: { apMac: "AA" } });
    assert.match(jsonOf(r).result.path, /\/sites\/aaaaaaaaaaaaaaaaaaaaaaaa\//);
  });

  test("unknown site name gives a helpful error", async () => {
    const { call } = await connect();
    const r = await call("omada_call_operation", { operationId: "getApVlanConfigV2", params: { siteId: "Nope", apMac: "AA" } });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /No site named "Nope". Sites: Home, Office/);
  });

  test("missing required params are reported", async () => {
    const { call } = await connect();
    const r = await call("omada_call_operation", { operationId: "getApVlanConfigV2", params: { siteId: SITE_ID } });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /Missing required parameter\(s\) for getApVlanConfigV2: apMac/);
  });

  test("expired token is renewed and the call retried", async () => {
    const { call } = await connect();
    await call("omada_call_operation", { operationId: "getSiteList" });
    state.grants.length = 0;
    state.expireNext = true;
    const r = await call("omada_call_operation", { operationId: "getSiteList" });
    assert.equal(r.isError, false);
    assert.deepEqual(state.grants, ["refresh_token"]);
  });

  test("JSON body and query flattening", async () => {
    const { call } = await connect();
    const r = await call("omada_call_operation", {
      operationId: "refreshDnsCacheListTemplate",
      params: { siteTemplateId: "t1", vo: { type: 1, page: 2 }, extra: ["a", "b"] },
    });
    assert.equal(r.isError, false);
    assert.deepEqual(lastRequest().query, [
      ["type", "1"],
      ["page", "2"],
      ["extra", "a"],
      ["extra", "b"],
    ]);
  });

  test("POST with JSON body (body given as a string is parsed)", async () => {
    const { call } = await connect();
    const r = await call("omada_call_operation", { operationId: "createNewSite", body: '{"name":"Lab"}' });
    assert.equal(r.isError, false);
    assert.equal(lastRequest().method, "POST");
    assert.deepEqual(lastRequest().body, { name: "Lab" });
  });

  test("multipart upload with a JSON part and a file", async () => {
    const { call } = await connect();
    const r = await call("omada_call_operation", {
      operationId: "createGoogleLdapProfile",
      params: { siteId: SITE_ID },
      body: { config: { name: "ldap" } },
      files: { file: { text: "CERT", filename: "google.crt" } },
    });
    assert.equal(r.isError, false, textOf(r));
    const parts = lastRequest().parts!;
    const config = parts.find((p) => p.name === "config")!;
    const file = parts.find((p) => p.name === "file")!;
    assert.equal(config.type, "application/json");
    assert.deepEqual(JSON.parse(config.value), { name: "ldap" });
    assert.equal(file.filename, "google.crt");
    assert.equal(file.value, "CERT");
  });

  test("multipart upload without the required file is rejected", async () => {
    const { call } = await connect();
    const r = await call("omada_call_operation", { operationId: "uploadVpnCertificateFile", params: { siteId: SITE_ID } });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /needs file\(s\): file/);
  });

  test("controller errors are flagged with a hint", async () => {
    const { call } = await connect();
    const r = await call("omada_request", { method: "GET", path: "/openapi/v1/{omadacId}/forbidden" });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /errorCode -1005/);
    assert.match(textOf(r), /Hint: Operation forbidden/);
  });

  test("raw request fills {omadacId}", async () => {
    const { call } = await connect();
    const r = await call("omada_request", { method: "GET", path: "/openapi/v1/{omadacId}/anything", query: { a: 1 } });
    assert.equal(jsonOf(r).result.path, `/openapi/v1/${OMADAC_ID}/anything`);
    assert.deepEqual(jsonOf(r).result.query, [["a", "1"]]);
  });

  test("raw request cannot leave the controller", async () => {
    const { call } = await connect();
    const r = await call("omada_request", { method: "GET", path: "//evil.example.com/x" });
    assert.equal(r.isError, true);
  });

  test("status reports a working connection", async () => {
    const { call } = await connect();
    const info = jsonOf(await call("omada_status"));
    assert.equal(info.connection, "ok");
    assert.equal(info.omadacId, OMADAC_ID);
  });

  test("bad credentials give a clear error", async () => {
    const { call } = await connect({ clientSecret: "wrong" });
    const r = await call("omada_call_operation", { operationId: "getSiteList" });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /client id or client secret is invalid/);
  });
});

describe("modes", () => {
  test("read-only mode blocks writes", async () => {
    const { call, mcp } = await connect({ readOnly: true });
    const r = await call("omada_call_operation", { operationId: "rebootDevice", params: { siteId: SITE_ID, deviceMac: "AA" } });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /disabled by this server's configuration/);
    const raw = await call("omada_request", { method: "POST", path: "/openapi/v1/{omadacId}/sites" });
    assert.equal(raw.isError, true);
    const search = textOf(await call("omada_search_operations", { query: "reboot device" }));
    assert.doesNotMatch(search, /rebootDevice /);
    assert.ok((await mcp.listTools()).tools.find((t) => t.name === "omada_call_operation")?.annotations?.readOnlyHint);
  });

  test("full mode exposes one tool per operation, filtered by tag", async () => {
    const { mcp, call } = await connect({ toolMode: "full", includeTags: ["Site"] });
    const tools = (await mcp.listTools()).tools;
    const site = tools.find((t) => t.name === "getSiteList");
    assert.ok(site, "getSiteList tool missing");
    assert.ok(!tools.find((t) => t.name === "rebootDevice"), "filter not applied");
    assert.equal(site!.annotations?.readOnlyHint, true);
    assert.ok(!(site!.inputSchema.required ?? []).includes("omadacId"));
    const r = await call("getSiteList", { searchKey: "Ho" });
    assert.equal(r.isError, false);
    assert.deepEqual(lastRequest().query, [
      ["page", "1"],
      ["pageSize", "100"],
      ["searchKey", "Ho"],
    ]);
  });

  test("full mode without filters exposes every operation", async () => {
    const { mcp } = await connect({ toolMode: "full" });
    const tools = (await mcp.listTools()).tools;
    assert.equal(tools.length, bundled.operations.length + 7);
  });

  test("authorization-code mode logs in with username/password", async () => {
    state.grants.length = 0;
    const { call } = await connect({ username: "admin", password: "pw" });
    const r = await call("omada_call_operation", { operationId: "getSiteList" });
    assert.equal(r.isError, false, textOf(r));
    assert.deepEqual(state.grants, ["authorization_code"]);
  });

  test("HTTP transport with bearer token", async () => {
    const cfg = config({ transport: "http", httpToken: "s3cret" });
    const ctx = new AppContext(cfg, new OmadaClient(cfg), Promise.resolve(bundled));
    const http = await startHttp(ctx, cfg);
    const port = (http.address() as { port: number }).port;
    try {
      const url = new URL(`http://127.0.0.1:${port}/mcp`);
      const denied = await fetch(url, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      assert.equal(denied.status, 401);

      const mcp = new Client({ name: "t", version: "1" });
      await mcp.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: "Bearer s3cret" } } }));
      const tools = await mcp.listTools();
      assert.ok(tools.tools.find((t) => t.name === "omada_call_operation"));
      const r = (await mcp.callTool({ name: "omada_call_operation", arguments: { operationId: "getSiteList" } })) as CallToolResult;
      assert.equal(r.isError, false);
      await mcp.close();
    } finally {
      await new Promise((r) => http.close(r));
    }
  });
});
