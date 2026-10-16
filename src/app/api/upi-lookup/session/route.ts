import { NextResponse, type NextRequest } from "next/server";

import { rateLimit } from "@/lib/payment/rate-limit";
import {
  createSessionToken,
  getSessionFromRequest,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  usingInsecureSessionSecret,
} from "@/lib/upi-lookup/session";

export const dynamic = "force-dynamic";

/**
 * DEMO-grade session for the recipient-lookup feature.
 *
 * Production note (see docs/upi-recipient-discovery.md §5): replace this with
 * your real identity layer (PSP merchant auth / OAuth / NextAuth). It exists
 * here so "authenticated access" + per-session anti-abuse limits are actually
 * enforced and testable.
 *
 * GET    → current session (or { authenticated: false })
 * POST   → create a demo session { name? }  (rate-limited)
 * DELETE → sign out
 */

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({
    authenticated: true,
    session: { name: session.name, expiresAt: new Date(session.exp).toISOString() },
    insecureSecret: usingInsecureSessionSecret(),
  });
}

export async function POST(request: NextRequest) {
  const limit = await rateLimit(request, "lookupSessionCreate");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  let name = "";
  try {
    const body = (await request.json()) as { name?: unknown };
    if (typeof body?.name === "string") name = body.name;
  } catch {
    // Empty body is fine — name is optional.
  }

  const { token, data } = createSessionToken(name);
  const response = NextResponse.json(
    {
      authenticated: true,
      session: { name: data.name, expiresAt: new Date(data.exp).toISOString() },
      insecureSecret: usingInsecureSessionSecret(),
    },
    { status: 201 }
  );
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(SESSION_TTL_SECONDS));
  return response;
}

export async function DELETE(request: NextRequest) {
  const session = getSessionFromRequest(request);
  const response = NextResponse.json({ authenticated: false });
  // Overwrite with an already-expired cookie rather than deleting, so the
  // invalid signature can never be replayed from a cached header.
  response.cookies.set(SESSION_COOKIE_NAME, "", sessionCookieOptions(0));
  if (session) {
    // No PII: only the random session id prefix touches the log.
    console.log(`[upi-lookup] session ${session.sid.slice(0, 8)}… signed out`);
  }
  return response;
}
