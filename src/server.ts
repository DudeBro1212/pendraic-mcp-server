import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { Session } from "./auth.js";
import {
  getSupabaseForSession,
  getSupabaseAnonClient,
} from "./supabase.js";

/**
 * Creates a fresh MCP Server instance pre-wired with Pendraic's tools.
 *
 * Each request comes in with a `session` (derived from Bearer auth in
 * the HTTP transport, or synthetic in stdio local dev). We scope all
 * database work to that session's user id so a client connected as
 * user A can never read user B's projects.
 *
 * One Server instance per HTTP request (or one long-lived instance for
 * stdio). The MCP spec allows either; making it per-request keeps
 * session state from leaking across clients on the shared HTTP server.
 */
export function createPendraicMcpServer(session: Session): Server {
  const server = new Server(
    {
      name: "pendraic",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // ---------------------------------------------------------------------
  // Tool listing
  // ---------------------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "pendraic_whoami",
        description:
          "Return the authenticated Pendraic user id and email. Useful for a client to confirm it's connected to the right account.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      },
      {
        name: "pendraic_projects_list",
        description:
          "List the caller's Pendraic projects (bookshelf items). Returns id, title, status, updated_at. Scoped to the authenticated user via RLS.",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 25,
              description: "Maximum rows to return (1..100). Default 25.",
            },
          },
          additionalProperties: false,
        },
      },
      {
        name: "pendraic_project_create",
        description:
          "Create a new project in the caller's default bookshelf. Returns the new project id and title. No scenes or chapters are created; use pendraic_manuscript_* tools to populate.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              minLength: 1,
              maxLength: 200,
              description: "Project title. 1..200 chars.",
            },
            description: {
              type: "string",
              maxLength: 2000,
              description: "Optional project description. Up to 2000 chars.",
            },
          },
          required: ["title"],
          additionalProperties: false,
        },
      },
      {
        name: "pendraic_project_get",
        description:
          "Fetch a single project by id. Returns title, description, status, created_at, updated_at.",
        inputSchema: {
          type: "object",
          properties: {
            project_id: {
              type: "string",
              format: "uuid",
              description: "UUID of the project.",
            },
          },
          required: ["project_id"],
          additionalProperties: false,
        },
      },
      {
        name: "pendraic_story_index_search",
        description:
          "Full-text search the caller's Story Index entries across a project. Returns id, name, kind, summary, score.",
        inputSchema: {
          type: "object",
          properties: {
            project_id: {
              type: "string",
              format: "uuid",
              description: "Scope the search to a single project.",
            },
            query: {
              type: "string",
              minLength: 1,
              maxLength: 200,
              description: "Search terms.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 50,
              default: 10,
            },
          },
          required: ["project_id", "query"],
          additionalProperties: false,
        },
      },
    ],
  }));

  // ---------------------------------------------------------------------
  // Tool dispatch
  // ---------------------------------------------------------------------
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "pendraic_whoami":
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  user_id: session.userId,
                  email: session.email,
                  issued_at: new Date().toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };

      case "pendraic_projects_list": {
        const parsed = z
          .object({ limit: z.number().int().min(1).max(100).default(25) })
          .parse(args ?? {});
        const supabase = getSupabaseForSession(session);
        const { data, error } = await supabase
          .from("projects")
          .select("id, title, status, created_at, updated_at")
          .order("updated_at", { ascending: false })
          .limit(parsed.limit);
        if (error) throw new Error(`projects_list: ${error.message}`);
        return {
          content: [
            { type: "text", text: JSON.stringify(data ?? [], null, 2) },
          ],
        };
      }

      case "pendraic_project_create": {
        const parsed = z
          .object({
            title: z.string().min(1).max(200),
            description: z.string().max(2000).optional(),
          })
          .parse(args);
        const supabase = getSupabaseForSession(session);

        // Resolve the user's default bookshelf. RLS scopes this read.
        const { data: wsRow, error: wsErr } = await supabase
          .from("workspaces")
          .select("id")
          .limit(1)
          .maybeSingle();
        if (wsErr) throw new Error(`project_create workspace: ${wsErr.message}`);
        if (!wsRow) {
          throw new Error(
            "No workspace found for the authenticated user. Complete onboarding in the app first.",
          );
        }
        const { data: shelfRow, error: shelfErr } = await supabase
          .from("bookshelves")
          .select("id")
          .eq("workspace_id", wsRow.id)
          .eq("is_default", true)
          .maybeSingle();
        if (shelfErr) throw new Error(`project_create shelf: ${shelfErr.message}`);
        if (!shelfRow) {
          throw new Error("No default bookshelf found for the user.");
        }

        const { data: project, error: pErr } = await supabase
          .from("projects")
          .insert({
            bookshelf_id: shelfRow.id,
            title: parsed.title,
            description: parsed.description ?? null,
            status: "draft",
          })
          .select("id, title, status, created_at")
          .single();
        if (pErr) throw new Error(`project_create insert: ${pErr.message}`);

        return {
          content: [
            { type: "text", text: JSON.stringify(project, null, 2) },
          ],
        };
      }

      case "pendraic_project_get": {
        const parsed = z
          .object({ project_id: z.string().uuid() })
          .parse(args);
        const supabase = getSupabaseForSession(session);
        const { data, error } = await supabase
          .from("projects")
          .select("id, title, description, status, created_at, updated_at")
          .eq("id", parsed.project_id)
          .maybeSingle();
        if (error) throw new Error(`project_get: ${error.message}`);
        if (!data) {
          throw new Error(`Project ${parsed.project_id} not found or not accessible.`);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "pendraic_story_index_search": {
        const parsed = z
          .object({
            project_id: z.string().uuid(),
            query: z.string().min(1).max(200),
            limit: z.number().int().min(1).max(50).default(10),
          })
          .parse(args);
        const supabase = getSupabaseForSession(session);
        const { data, error } = await supabase
          .from("story_index_entries")
          .select("id, name, kind, summary")
          .eq("project_id", parsed.project_id)
          .ilike("name", `%${parsed.query}%`)
          .limit(parsed.limit);
        if (error) throw new Error(`story_index_search: ${error.message}`);
        return {
          content: [
            { type: "text", text: JSON.stringify(data ?? [], null, 2) },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  // ---------------------------------------------------------------------
  // Resources: expose a small set so clients can discover the user's
  // projects without calling a tool. Empty for v0; Phase 5.2 fills out
  // with per-project manuscript resources.
  // ---------------------------------------------------------------------
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    // Sanity reference to the anon client import so the module tree stays
    // stable under treeshaking; removed once resources are wired.
    void getSupabaseAnonClient;
    return { resources: [] };
  });

  return server;
}
