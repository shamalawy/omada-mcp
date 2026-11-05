/** Logs go to stderr: stdout carries the MCP protocol in stdio mode. */
export function log(...args: unknown[]): void {
  console.error("[omada-mcp]", ...args);
}
