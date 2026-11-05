#!/usr/bin/env node
/**
 * omada-mcp: MCP server for the TP-Link Omada Open API.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OmadaClient } from "./client.js";
import { loadConfig } from "./config.js";
import { startHttp } from "./http.js";
import { log } from "./log.js";
import { AppContext, createMcpServer } from "./server.js";
import { loadSpec } from "./spec.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const client = new OmadaClient(cfg);

  // Unauthenticated first; retry with the access token if the controller wants one.
  const fetcher = async (path: string): Promise<unknown> => {
    const timeoutMs = Math.min(cfg.timeoutMs, 10000);
    let res = await client.request({ method: "GET", path, auth: false, timeoutMs });
    if ((res.status === 401 || res.status === 403) && cfg.clientId && cfg.clientSecret) {
      res = await client.request({ method: "GET", path, timeoutMs });
    }
    return res.status === 200 ? res.data : undefined;
  };

  const spec = loadSpec(cfg, fetcher);
  spec.then(
    (s) => log(`Loaded ${s.operations.length} operations (${s.source}).`),
    (e) => log(`Failed to load the API spec: ${(e as Error).message}`),
  );

  const ctx = new AppContext(cfg, client, spec);
  if (cfg.transport === "http") {
    await startHttp(ctx, cfg);
  } else {
    const server = createMcpServer(ctx);
    await server.connect(new StdioServerTransport());
    log("Ready on stdio.");
  }
}

main().catch((e) => {
  log(`Fatal: ${(e as Error).message}`);
  process.exit(1);
});
