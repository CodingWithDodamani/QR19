import crypto from "crypto";

import type { NextRequest } from "next/server";

/**
 * Lightweight signed-cookie session for the recipient-lookup endpoints.
 *
 * Why sessions at all? Requirement: "Require authenticated access" and
 * "safeguards against bulk lookup / contact harvesting / enumeration".
 * A session gives us a stable per-user rate-limit key that is harder to
 * rotate than an IP alone.
 *
 * HONEST LABEL: this is a DEMO-grade authentication layer. It proves the
 * gating + rate-limit wiring; a production deployment replaces it with real
 * identity (your PSP's merchant auth, OAuth, or NextAuth) — see
 * docs/upi-recipient-discovery.md §5. Nothing here handles credentials:
 * no passwords are collected, and no UPI PIN / banking secret is ever touched.
 */

const COOKIE_NAME = "upi_lookup_session";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface SessionData {
  /** Random session id — rate-limit key. Never a secret. */
  sid: string;
  /** Optional display name chosen at demo sign-in. */
  name: string;
  /** Expiry (epoch ms). */
  exp: number;
}

function secret(): string {
  const value = process.env.SESSION_SECRET?.trim();
  if (value && value.length >= 16) return value;
  // Dev/demo fallback — tokens are still HMAC-signed, but the key is public.
  // Production MUST set SESSION_SECRET (checked in docs + endpoint warning).
  return "one999-demo-only-insecure-session-secret";
}

export function usingInsecureSessionSecret(): boolean {
  const value = process.env.SESSION_SECRET?.trim();
  return !value || value.length < 16;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(name: string): { token: string; data: SessionData } {
  const data: SessionData = {
    sid: crypto.randomUUID(),
    name: name.trim().slice(0, 40) || "Demo user",
    exp: Date.now() + TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, data };
}

export function verifySessionToken(token: string | undefined): SessionData | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionData;
    if (
      typeof data.sid !== "string" ||
      typeof data.name !== "string" ||
      typeof data.exp !== "number" ||
      data.exp < Date.now()
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request: NextRequest): SessionData | null {
  return verifySessionToken(request.cookies.get(COOKIE_NAME)?.value);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_TTL_SECONDS = Math.floor(TTL_MS / 1000);

export function sessionCookieOptions(maxAgeSecs: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSecs,
  };
}
