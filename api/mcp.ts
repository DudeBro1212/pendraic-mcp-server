/**
 * Vercel serverless entry point.
 *
 * Vercel's @vercel/node runtime passes Node's native (req, res) pair,
 * which is exactly what our existing http route handler consumes. We
 * import and dispatch the same route function used by the standalone
 * http server, so local dev and Vercel behave identically.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { AuthError, validateBearerToken } from "../src/auth.js";
import { createPendraicMcpServer } from "../src/server.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export const config = {
  maxDuration: 60,
};

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(
    req.url ?? "/",
    `https://${req.headers.host ?? "localhost"}`,
  );
  const method = (req.method ?? "GET").toUpperCase();

  setCors(res);

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      "<h1>Pendraic MCP</h1><p>See <a href=\"https://www.pendraic.com/app/penny\">pendraic.com/app/penny</a> for install instructions.</p>",
    );
    return;
  }

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === "/.well-known/mcp") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        name: "pendraic",
        version: "0.1.0",
        transport: "streamable-http",
        auth: { type: "bearer" },
        docs: "https://www.pendraic.com/app/penny",
      }),
    );
    return;
  }

  if (url.pathname === "/mcp" || url.pathname === "/api/mcp") {
    try {
      const authHeader = req.headers["authorization"];
      const bearer = typeof authHeader === "string" ? authHeader : undefined;
      if (!bearer || !bearer.toLowerCase().startsWith("bearer ")) {
        throw new AuthError(
          "missing_token",
          "Authorization: Bearer <token> required",
        );
      }
      const session = await validateBearerToken(bearer.slice(7).trim());
      const server = createPendraicMcpServer(session);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      const status = err instanceof AuthError && err.code === "server_misconfigured" ? 500 : 401;
      if (!res.headersSent) {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: err instanceof AuthError ? err.code : "unauthorized",
            message: err instanceof Error ? err.message : "auth failed",
          }),
        );
      }
    }
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found", path: url.pathname }));
}

function setCors(res: ServerResponse) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "authorization, content-type, mcp-session-id",
  );
  res.setHeader("access-control-expose-headers", "mcp-session-id");
}
