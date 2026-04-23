import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { AuthError, validateBearerToken } from "../auth.js";
import { createPendraicMcpServer } from "../server.js";

/**
 * Streamable HTTP transport for the Pendraic MCP server.
 *
 * Handles:
 *   * `POST /mcp` — MCP JSON-RPC messages from clients.
 *   * `GET /mcp`  — SSE stream for server → client messages.
 *   * `GET /`     — friendly landing page so humans who visit the URL
 *     see something other than a 404.
 *   * `GET /.well-known/mcp` — metadata endpoint advertising the tool
 *     catalog and auth requirements. Clients that discover via URL use
 *     this to decide how to connect.
 *
 * Auth: Bearer token on every MCP request. Token is validated per-
 * request, not cached; Pendraic's JWT is short-lived (~1h) and the
 * cost of re-validating is a single HMAC verify.
 *
 * One MCP Server instance per request so sessions don't bleed between
 * concurrent callers. This is the pattern the @modelcontextprotocol/sdk
 * README recommends for stateless HTTP deployments.
 */
export async function runHttpServer(opts: { port: number }): Promise<void> {
  const { port } = opts;

  const httpServer = createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      console.error("[pendraic-mcp/http] unhandled:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "internal_error",
            message: err instanceof Error ? err.message : "unknown",
          }),
        );
      }
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      console.log(`[pendraic-mcp] HTTP server listening on :${port}`);
      resolve();
    });
  });
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = (req.method ?? "GET").toUpperCase();

  // CORS preflight — Claude Desktop doesn't need it, but it keeps the
  // server usable from a browser during debugging.
  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...corsHeaders() });
    res.end(landingHtml());
    return;
  }

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json", ...corsHeaders() });
    res.end(JSON.stringify({ ok: true, name: "pendraic-mcp", version: "0.1.0" }));
    return;
  }

  if (url.pathname === "/.well-known/mcp" && method === "GET") {
    res.writeHead(200, { "content-type": "application/json", ...corsHeaders() });
    res.end(
      JSON.stringify(
        {
          name: "pendraic",
          version: "0.1.0",
          transport: "streamable-http",
          auth: {
            type: "bearer",
            token_hint:
              "Paste your Pendraic MCP install token. Generate one from /app/penny in your Pendraic dashboard.",
          },
          docs: "https://www.pendraic.com/app/penny",
        },
        null,
        2,
      ),
    );
    return;
  }

  if (url.pathname === "/mcp") {
    // Auth: Bearer required.
    let session;
    try {
      session = await authenticate(req);
    } catch (err) {
      const status = err instanceof AuthError && err.code === "server_misconfigured"
        ? 500
        : 401;
      res.writeHead(status, {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="pendraic-mcp"',
        ...corsHeaders(),
      });
      res.end(
        JSON.stringify({
          error: err instanceof AuthError ? err.code : "auth_failed",
          message: err instanceof Error ? err.message : "unauthorized",
        }),
      );
      return;
    }

    const server = createPendraicMcpServer(session);
    const transport = new StreamableHTTPServerTransport({
      // Stateless mode: every HTTP request creates a new transport/session
      // pair. Claude Desktop's client is happy with either mode; stateless
      // keeps our hosting simple (no sticky sessions needed on Vercel /
      // any serverless platform).
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404, { "content-type": "application/json", ...corsHeaders() });
  res.end(JSON.stringify({ error: "not_found", path: url.pathname }));
}

async function authenticate(req: IncomingMessage) {
  const header = req.headers["authorization"];
  const bearer = typeof header === "string" ? header : Array.isArray(header) ? header[0] : undefined;
  if (!bearer || !bearer.toLowerCase().startsWith("bearer ")) {
    throw new AuthError("missing_token", "Authorization: Bearer <token> required");
  }
  const token = bearer.slice(7).trim();
  return validateBearerToken(token);
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, mcp-session-id",
    "access-control-expose-headers": "mcp-session-id",
  };
}

function landingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pendraic MCP server</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 4rem auto; padding: 0 1.5rem; color: #1e1a14; line-height: 1.55; }
    code { background: #f3eedf; padding: 2px 6px; border-radius: 4px; }
    a { color: #6d28d9; }
  </style>
</head>
<body>
  <h1>Pendraic MCP</h1>
  <p>This endpoint speaks the Model Context Protocol over Streamable HTTP.</p>
  <p>If you're a human browsing here, you probably want the install instructions at <a href="https://www.pendraic.com/app/penny">pendraic.com/app/penny</a>.</p>
  <p>If you're an MCP client, point at <code>/mcp</code> with a Bearer token.</p>
</body>
</html>`;
}
