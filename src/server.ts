import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { OmadaClient } from "./client.js";
import type { Config } from "./config.js";
import type { ApiSpec } from "./spec.js";
import { buildTools, errorResult, type ToolDef } from "./tools.js";
import { VERSION } from "./version.js";

/** Shared state: one client and one spec for all MCP sessions. */
export class AppContext {
  private tools?: Promise<{ list: ToolDef[]; byName: Map<string, ToolDef> }>;

  constructor(
    readonly cfg: Config,
    readonly client: OmadaClient,
    readonly spec: Promise<ApiSpec>,
  ) {}

  getTools(): Promise<{ list: ToolDef[]; byName: Map<string, ToolDef> }> {
    this.tools ??= this.spec.then((spec) => {
      const list = buildTools({ cfg: this.cfg, client: this.client, spec });
      return { list, byName: new Map(list.map((t) => [t.name, t])) };
    });
    return this.tools;
  }
}

function instructions(cfg: Config): string {
  return [
    "Omada Open API server: every operation of the TP-Link Omada controller's Open API is available.",
    "Workflow: omada_search_operations (or omada_list_tags) to find an operation -> omada_describe_operation for its parameters and body -> omada_call_operation to run it.",
    "omadacId/mspId are filled in automatically. siteId accepts a site ID or a site name" +
      (cfg.defaultSite ? ` (default site: ${cfg.defaultSite}).` : "."),
    "List operations are paged: page/pageSize default to 1/100 (max pageSize is usually 1000).",
    "Replies are {errorCode, msg, result}; errorCode 0 means success.",
    cfg.readOnly ? "This server is read-only: only GET operations are enabled." : "",
    cfg.toolMode === "full" ? "Each operation is also available as its own tool named by its operationId." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function createMcpServer(ctx: AppContext): Server {
  const server = new Server(
    { name: "omada-mcp", version: VERSION },
    { capabilities: { tools: {} }, instructions: instructions(ctx.cfg) },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { list } = await ctx.getTools();
    return {
      tools: list.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema as { type: "object"; [k: string]: unknown },
        annotations: t.annotations,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    let tools;
    try {
      tools = await ctx.getTools();
    } catch (e) {
      return errorResult(new Error(`The Omada API spec failed to load: ${(e as Error).message}`));
    }
    const tool = tools.byName.get(req.params.name);
    if (!tool) return errorResult(new Error(`Unknown tool: ${req.params.name}`));
    try {
      return await tool.handler((req.params.arguments ?? {}) as Record<string, unknown>);
    } catch (e) {
      return errorResult(e);
    }
  });

  return server;
}
