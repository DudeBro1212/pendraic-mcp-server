import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Session } from "./auth.js";

let _anonClient: SupabaseClient | null = null;

/**
 * Anon client — used for unauthenticated metadata reads (if any). Every
 * user-scoped call in the MCP server should go through
 * `getSupabaseForSession()` instead so RLS enforces user isolation.
 */
export function getSupabaseAnonClient(): SupabaseClient {
  if (_anonClient) return _anonClient;
  const url = requireEnv("PENDRAIC_SUPABASE_URL");
  const anon = requireEnv("PENDRAIC_SUPABASE_ANON_KEY");
  _anonClient = createClient(url, anon, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "x-pendraic-client": "mcp-server" },
    },
  });
  return _anonClient;
}

/**
 * Build a Supabase client that forwards the session's JWT as the user's
 * auth. Pendraic's RLS policies (user_owns_workspace, user_owns_bookshelf,
 * etc.) fire on every query, so even if our tool layer had a bug the
 * database would still refuse cross-user reads.
 *
 * A fresh client is created per session so the JWT doesn't leak between
 * concurrent MCP calls.
 */
export function getSupabaseForSession(session: Session): SupabaseClient {
  const url = requireEnv("PENDRAIC_SUPABASE_URL");
  const anon = requireEnv("PENDRAIC_SUPABASE_ANON_KEY");
  return createClient(url, anon, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "x-pendraic-client": "mcp-server",
        Authorization: `Bearer ${session.token}`,
      },
    },
  });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}
