import { NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  type SessionData,
} from "@/lib/upi-lookup/session";

/**
 * Auth gate for PSP-console mutations (configure / test / disconnect /
 * event monitor). Reuses the app's signed-session cookie — the same gate
 * the recipient finder uses — so credentials can only be changed by an
 * authenticated operator.
 *
 * HONEST LABEL: demo-grade auth (documented in upi-lookup/session.ts).
 * A production deployment must put the console behind real merchant
 * admin auth (see docs/psp-console.md).
 */

export function sessionFromRequest(request: Request): SessionData | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const pair = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!pair) return null;
  return verifySessionToken(pair.slice(SESSION_COOKIE_NAME.length + 1));
}

export function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Sign in first — PSP settings can only be changed by an authenticated operator." },
    { status: 401 }
  );
}

/** Best-effort public origin of this deployment, honoring proxy headers. */
export function publicOrigin(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") || host?.startsWith("127.0.0.1") ? "http" : "https");
  if (host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}
