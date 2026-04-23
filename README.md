# Pendraic MCP Server

Connect [Claude Desktop](https://claude.ai/download), [Claude Code](https://docs.claude.com/en/docs/claude-code/overview), or any [MCP](https://modelcontextprotocol.io)-compatible client to your [Pendraic](https://www.pendraic.com) account. Once installed, the client can list your projects, read your Story Index and World Index, and create new projects on your behalf.

This is the MCP server only. The main Pendraic app lives at [DudeBro1212/pendraic2026](https://github.com/DudeBro1212/pendraic2026).

## Status

v0.1 — functional with Bearer-token auth. The production flow (OAuth 2.1 with Dynamic Client Registration) is tracked as a follow-up.

Currently working:

- Bearer-token authentication against Pendraic's Supabase JWT.
- Streamable HTTP transport for remote installs (Vercel-deployable).
- Stdio transport for local installs via Claude Desktop.
- Tools: `pendraic_whoami`, `pendraic_projects_list`, `pendraic_project_create`, `pendraic_project_get`, `pendraic_story_index_search`.

Coming next:

- OAuth 2.1 + Dynamic Client Registration so clients can self-install without manual token pasting.
- Manuscript CRUD tools (chapter, scene get/update).
- Iteration pass enqueue tool.
- MCP Resources for projects and chapters.

## How to install

### 1. Get a token

Sign in to your Pendraic dashboard and visit [pendraic.com/app/penny](https://www.pendraic.com/app/penny). Generate an MCP install token. The token is a standard Supabase JWT scoped to your user.

### 2. Choose your client

#### Claude Desktop (local, via npx)

Add to your Claude Desktop config (usually `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "pendraic": {
      "command": "npx",
      "args": ["-y", "pendraic-mcp-server"],
      "env": {
        "PENDRAIC_MCP_TOKEN": "<paste token from /app/penny>",
        "PENDRAIC_SUPABASE_URL": "https://<your-project>.supabase.co",
        "PENDRAIC_SUPABASE_ANON_KEY": "<anon key from Pendraic>",
        "SUPABASE_JWT_SECRET": "<jwt secret or leave unset to use issuer check only>"
      }
    }
  }
}
```

Restart Claude Desktop. Run `/mcp` to verify the server connected.

#### Claude Desktop (remote, via hosted URL)

Once deployed to your host (e.g., `https://mcp.pendraic.com`), Claude Desktop's Settings > Developer > Edit Config accepts:

```json
{
  "mcpServers": {
    "pendraic": {
      "type": "http",
      "url": "https://mcp.pendraic.com/mcp",
      "headers": {
        "Authorization": "Bearer <paste token from /app/penny>"
      }
    }
  }
}
```

#### Claude Code

```
claude mcp add pendraic https://mcp.pendraic.com/mcp
```

Then run `claude` inside any project directory and use `/mcp` to confirm the connection.

### 3. Try a tool

In Claude, ask something like:

> List my Pendraic projects.

Claude will call `pendraic_projects_list` and surface the result.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in credentials
npm run dev
```

The stdio transport is the default; Claude Desktop can launch it directly. To test the HTTP transport:

```bash
MCP_TRANSPORT=http PORT=3000 npm run dev
```

## Environment

| Variable                      | Required | Description                                                         |
| ----------------------------- | -------- | ------------------------------------------------------------------- |
| `PENDRAIC_SUPABASE_URL`       | yes      | Supabase URL for the Pendraic project.                              |
| `PENDRAIC_SUPABASE_ANON_KEY`  | yes      | Supabase anon key.                                                  |
| `SUPABASE_JWT_SECRET`         | yes      | HS256 secret used to verify the user's JWT signature.               |
| `SUPABASE_JWT_ISSUER`         | no       | Expected `iss` claim. Defaults to Supabase's project issuer URL.    |
| `PENDRAIC_MCP_TOKEN`          | stdio    | Bearer token for stdio transport. Not used by the HTTP transport.   |
| `MCP_TRANSPORT`               | no       | `stdio` (default) or `http`.                                        |
| `PORT`                        | no       | HTTP port. Defaults to `3000`. Ignored for stdio.                   |

## Security

- **Never share your Pendraic MCP token.** It grants full read/write access to your projects, worlds, and manuscripts, scoped to your user.
- Tokens are short-lived. If you need longer sessions, generate a new token before the old one expires.
- Every tool runs under your user's Supabase RLS, so a compromised token cannot read another user's data. It can only act as you.

## License

MIT
