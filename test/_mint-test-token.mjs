#!/usr/bin/env node
/**
 * Dev helper: mint a test JWT for local MCP probing.
 *
 * Usage:
 *   SUPABASE_JWT_SECRET=... TEST_USER_ID=... node test/_mint-test-token.mjs
 *
 * Outputs the token to stdout. Intended for local dev / CI tests only —
 * in production the main Pendraic app issues tokens via /api/mcp/mint-token.
 */

import { SignJWT } from "jose";

const secret = process.env.SUPABASE_JWT_SECRET;
if (!secret) {
  console.error("SUPABASE_JWT_SECRET required");
  process.exit(1);
}
const userId = process.env.TEST_USER_ID ?? "00000000-0000-0000-0000-000000000000";

const key = new TextEncoder().encode(secret);
const token = await new SignJWT({
  sub: userId,
  email: "mcp-probe@example.invalid",
  role: "authenticated",
  aud: "authenticated",
  pendraic_mcp: true,
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(key);

console.log(token);
