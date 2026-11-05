/**
 * Streamable HTTP transport (stateless): POST /mcp, GET /health.
 * Bound to 127.0.0.1 by default. Set MCP_HTTP_TOKEN to require
 * "Authorization: Bearer <token>".
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import { createMcpServer, type AppContext } from "./server.js";
import { log } from "./log.js";

const MAX_BODY_BYTES = 50 * 1024 * 1024;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export function startHttp(ctx: AppContext, cfg: Config): Promise<HttpServer> {
  const loopback = LOOPBACK.has(cfg.httpHost);
  if (!loopback && !cfg.httpToken) {
    log(`WARNING: listening on ${cfg.httpHost} without MCP_HTTP_TOKEN. Anyone who can reach this port can control your network.`);
  }

  const httpServer = createServer((req, res) => {
    handle(ctx, cfg, loopback, req, res).catch((e) => {
      log("HTTP handler error:", e);
      if (!res.headersSent) sendJsonRpcError(res, 500, -32603, "Internal server error");
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(cfg.httpPort, cfg.httpHost, () => {
      const addr = httpServer.address();
      const port = typeof addr === "object" && addr ? addr.port : cfg.httpPort;
      log(`MCP over HTTP at http://${cfg.httpHost.includes(":") ? `[${cfg.httpHost}]` : cfg.httpHost}:${port}/mcp`);
      resolve(httpServer);
    });
  });
}

async function handle(ctx: AppContext, cfg: Config, loopback: boolean, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  if (url.pathname !== "/mcp") {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  if (cfg.httpToken && !tokenMatches(req.headers.authorization, cfg.httpToken)) {
    res.setHeader("WWW-Authenticate", "Bearer");
    sendJsonRpcError(res, 401, -32001, "Unauthorized");
    return;
  }
  if (req.method !== "POST") {
    // Stateless server: no SSE stream (GET) and no sessions to delete (DELETE).
    res.setHeader("Allow", "POST");
    sendJsonRpcError(res, 405, -32000, "Method not allowed.");
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    sendJsonRpcError(res, 400, -32700, `Parse error: ${(e as Error).message}`);
    return;
  }

  const port = (req.socket.localPort ?? cfg.httpPort).toString();
  const server = createMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    // Blocks DNS-rebinding attacks from web pages when bound to localhost.
    enableDnsRebindingProtection: loopback,
    allowedHosts: loopback ? [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`] : undefined,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJsonRpcError(res: ServerResponse, status: number, code: number, message: string) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
  );
}
