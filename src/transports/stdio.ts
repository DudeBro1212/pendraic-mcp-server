import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { validateBearerToken } from "../auth.js";
import { createPendraicMcpServer } from "../server.js";

/**
 * Stdio transport for local installs.
 *
 * Claude Desktop's MCP client config can launch this binary directly,
 * in which case communication happens over stdin/stdout. The token is
 * read from env (PENDRAIC_MCP_TOKEN) so the user can paste it once in
 * their Claude Desktop config and not see it per-request.
 *
 * Example Claude Desktop config snippet:
 *   "pendraic": {
 *     "command": "npx",
 *     "args": ["-y", "pendraic-mcp-server"],
 *     "env": { "PENDRAIC_MCP_TOKEN": "<paste token here>" }
 *   }
 */
export async function runStdioServer(): Promise<void> {
  const token = process.env.PENDRAIC_MCP_TOKEN;
  if (!token) {
    throw new Error(
      "PENDRAIC_MCP_TOKEN not set. Generate one from the Penny page in your Pendraic dashboard and add it to your Claude Desktop config under env.PENDRAIC_MCP_TOKEN.",
    );
  }
  const session = await validateBearerToken(token);

  const server = createPendraicMcpServer(session);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[pendraic-mcp] stdio server ready (user=${session.userId})`);
}
