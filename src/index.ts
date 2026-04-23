#!/usr/bin/env node
/**
 * Pendraic MCP server — entry point.
 *
 * Choose transport by NODE_ENV or MCP_TRANSPORT:
 *   * local / stdio (default for `npm run dev` without MCP_TRANSPORT):
 *     runs on stdio so the user's Claude Desktop config can launch the
 *     binary with `command: "node"` + `args: ["dist/index.js"]`.
 *   * http (MCP_TRANSPORT=http): serves the Streamable HTTP transport on
 *     PORT (default 3000). Used when deploying to a hosted URL for
 *     Claude Desktop's "remote server" option.
 *
 * Both transports share the same request handler (see ./server.ts),
 * which is where the tools + auth validation live.
 */

import { runHttpServer } from "./transports/http.js";
import { runStdioServer } from "./transports/stdio.js";

async function main() {
  const transport = process.env.MCP_TRANSPORT ?? "stdio";

  if (transport === "http") {
    const port = Number.parseInt(process.env.PORT ?? "3000", 10);
    await runHttpServer({ port });
    return;
  }

  if (transport === "stdio") {
    await runStdioServer();
    return;
  }

  throw new Error(
    `Unknown MCP_TRANSPORT '${transport}'. Use 'stdio' or 'http'.`,
  );
}

main().catch((err) => {
  console.error("[pendraic-mcp] fatal:", err);
  process.exit(1);
});
