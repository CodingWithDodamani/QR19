import crypto from "crypto";

import { NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  type SessionData,
} from "@/lib/upi-lookup/session";

/**
 * Admin gate for operator-only endpoints (P0-2):
 * - PSP console mutations: configure (POST/DELETE)
 * - PSP monitors: events, fraud-alerts (payment data)
 * - Staff overrides: order override, queue cancel (skip/cancel)
 *
 * Two accepted credentials:
 * 1. `Authorization: Bearer <ADMIN_TOKEN>` — the real production gate.
 *    Compared timing-safe against the trimmed env value. Required in
 *    production (boot guard in `src/lib/env.ts` refuses to start without it).
 * 2. Demo signed-session cookie — local-dev convenience ONLY. Accepted when
 *    `NODE_ENV !== "production"` OR when no ADMIN_TOKEN is configured (dev).
 *    In production with ADMIN_TOKEN set, the session alone is NOT enough.
 *
 * `psp/status` stays public (masked key id only, no secrets).
 */

function adminToken(): string {
  return process.env.ADMIN_TOKEN?.trim() ?? "";
}

export function adminAuthConfigured(): boolean {
  return adminToken().length >= 16;
}

/** Timing-safe bearer check — returns true only on exact ADMIN_TOKEN match. */
export function isAdminBearer(request: Request): boolean {
  const token = adminToken();
  if (token.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  if (!match) return false;
  const provided = Buffer.from(match[1].trim());
  const expected = Buffer.from(token);
  return (
    provided.length === expected.length && crypto.timingSafeEqual(provided, expected)
  );
}

function sessionFromCookieHeader(request: Request): SessionData | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const pair = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!pair) return null;
  return verifySessionToken(pair.slice(SESSION_COOKIE_NAME.length + 1));
}

/**
 * The single admin check for operator routes. Accepts the Bearer token
 * always; accepts the demo session only outside production (or when no
 * ADMIN_TOKEN is configured, i.e. plain local dev).
 */
export function isAdminRequest(request: Request): boolean {
  if (isAdminBearer(request)) return true;
  if (process.env.NODE_ENV === "production" && adminAuthConfigured()) return false;
  return sessionFromCookieHeader(request) !== null;
}

/** @deprecated Use isAdminRequest — kept for the incremental migration. */
export function sessionFromRequest(request: Request): SessionData | null {
  return sessionFromCookieHeader(request);
}

export function unauthorized(): NextResponse {
  return NextResponse.json(
    {
      error:
        "Operator sign-in required — this action is restricted to the merchant admin (ADMIN_TOKEN).",
    },
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
