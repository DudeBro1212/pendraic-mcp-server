import { jwtVerify, errors as joseErrors } from "jose";

/**
 * Session represents a validated MCP caller. Currently extracted from a
 * Bearer JWT signed by Pendraic's Supabase (same JWT the browser app
 * uses). Future OAuth 2.1 / Dynamic Client Registration (Phase 5.2)
 * issues dedicated MCP-scoped tokens instead; the Session shape stays
 * the same.
 */
export interface Session {
  userId: string;
  email: string | null;
  /** Raw token kept so outbound Supabase calls can forward it. */
  token: string;
  /** Unix seconds. */
  expiresAt: number;
}

/**
 * Validate a Bearer token and return a Session, or throw with a
 * stable error code the HTTP transport maps to 401.
 */
export async function validateBearerToken(bearer: string): Promise<Session> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    throw new AuthError("server_misconfigured", "SUPABASE_JWT_SECRET not set");
  }

  const key = new TextEncoder().encode(secret);
  try {
    const { payload } = await jwtVerify(bearer, key, {
      // Supabase's default issuer pattern. Project-specific; callers
      // can set SUPABASE_JWT_ISSUER to override.
      issuer: process.env.SUPABASE_JWT_ISSUER,
      algorithms: ["HS256"],
    });

    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) {
      throw new AuthError("invalid_token", "token missing `sub` (user id)");
    }
    const exp = typeof payload.exp === "number" ? payload.exp : 0;
    const email = typeof payload.email === "string" ? payload.email : null;

    return {
      userId: sub,
      email,
      token: bearer,
      expiresAt: exp,
    };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw new AuthError("expired", "token expired");
    }
    if (err instanceof joseErrors.JWTInvalid || err instanceof joseErrors.JWSInvalid) {
      throw new AuthError("invalid_token", "token signature invalid");
    }
    if (err instanceof AuthError) throw err;
    throw new AuthError(
      "invalid_token",
      err instanceof Error ? err.message : "token validation failed",
    );
  }
}

export class AuthError extends Error {
  code: "invalid_token" | "expired" | "server_misconfigured" | "missing_token";
  constructor(code: AuthError["code"], message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}
