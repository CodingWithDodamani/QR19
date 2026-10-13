"use client";

/**
 * Typed client helpers for the recipient-discovery endpoints.
 * All responses are discriminated unions so the UI can map every state
 * (loading / invalid / no match / unsupported / rate-limited / unavailable).
 */

export interface LookupConfig {
  mode: "demo" | "live";
  capabilities: { mobileNumberLookup: boolean };
  unsupportedReason: string | null;
  demo: {
    testNumbers: string[];
    failureNumber: string;
    note: string;
  } | null;
}

export interface FoundRecipient {
  kind: "found";
  payeeName: string;
  upiId: string;
  recipientToken: string;
  queriedMobileMasked?: string;
}

export type LookupOutcome =
  | { ok: true; mode: "demo" | "live"; disclaimer: string; result: FoundRecipient | { kind: "not_found" } }
  | { ok: false; state: "invalid" | "rate_limited" | "unsupported" | "unavailable" | "unauthorized" | "error"; message: string; retryAfterSecs?: number };

export type ValidateOutcome =
  | { ok: true; valid: true; normalized: string; message: string }
  | { ok: true; valid: false; message: string }
  | { ok: false; state: "rate_limited" | "unauthorized" | "error"; message: string; retryAfterSecs?: number };

export interface SessionInfo {
  authenticated: boolean;
  session?: { name: string; expiresAt: string };
  insecureSecret?: boolean;
}

async function readRetryAfter(response: Response): Promise<number | undefined> {
  const header = response.headers.get("Retry-After");
  const parsed = header ? Number.parseInt(header, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function fetchLookupConfig(): Promise<LookupConfig | null> {
  try {
    const response = await fetch("/api/upi-lookup", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as LookupConfig;
  } catch {
    return null;
  }
}

export async function fetchSession(): Promise<SessionInfo> {
  try {
    const response = await fetch("/api/upi-lookup/session", { cache: "no-store" });
    if (!response.ok) return { authenticated: false };
    return (await response.json()) as SessionInfo;
  } catch {
    return { authenticated: false };
  }
}

export async function createSession(name: string): Promise<
  { ok: true; session: SessionInfo } | { ok: false; retryAfterSecs?: number }
> {
  try {
    const response = await fetch("/api/upi-lookup/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (response.status === 429) {
      return { ok: false, retryAfterSecs: await readRetryAfter(response) };
    }
    if (!response.ok) return { ok: false };
    return { ok: true, session: (await response.json()) as SessionInfo };
  } catch {
    return { ok: false };
  }
}

export async function destroySession(): Promise<boolean> {
  try {
    const response = await fetch("/api/upi-lookup/session", { method: "DELETE" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function lookupRecipient(phone: string): Promise<LookupOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/upi-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
  } catch {
    return { ok: false, state: "error", message: "Network error — check your connection and try again." };
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const message = typeof data?.message === "string" ? data.message : "";

  // Map the wire format onto the client union explicitly (the API does not
  // send an `ok` flag — success is a 200 with a `result` field).
  if (response.ok && data && data.result && typeof data.result === "object") {
    const result = data.result as { kind: string } & Record<string, unknown>;
    if (result.kind === "found") {
      return {
        ok: true,
        mode: data.mode === "live" ? "live" : "demo",
        disclaimer: typeof data.disclaimer === "string" ? data.disclaimer : "",
        result: {
          kind: "found",
          payeeName: String(result.payeeName ?? ""),
          upiId: String(result.upiId ?? ""),
          recipientToken: String(result.recipientToken ?? ""),
          queriedMobileMasked:
            typeof result.queriedMobileMasked === "string" ? result.queriedMobileMasked : undefined,
        },
      };
    }
    if (result.kind === "not_found") {
      return {
        ok: true,
        mode: data.mode === "live" ? "live" : "demo",
        disclaimer: typeof data.disclaimer === "string" ? data.disclaimer : "",
        result: { kind: "not_found" },
      };
    }
  }
  if (response.status === 400) {
    return { ok: false, state: "invalid", message: message || "Enter a valid 10-digit Indian mobile number." };
  }
  if (response.status === 401) {
    return { ok: false, state: "unauthorized", message: "Your session expired — sign in again." };
  }
  if (response.status === 429) {
    return {
      ok: false,
      state: "rate_limited",
      message: message || "Too many lookups — please wait a moment.",
      retryAfterSecs: await readRetryAfter(response),
    };
  }
  if (response.status === 501) {
    return { ok: false, state: "unsupported", message: message || "Mobile-number lookup is not supported by the current provider." };
  }
  if (response.status === 503) {
    return { ok: false, state: "unavailable", message: message || "The lookup service is temporarily unavailable." };
  }
  return { ok: false, state: "error", message: message || "Something went wrong. Try again." };
}

export async function validateUpiId(
  upiId: string
): Promise<ValidateOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/upi-lookup/validate-upi-id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upiId }),
    });
  } catch {
    return { ok: false, state: "error", message: "Network error — check your connection and try again." };
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const message = typeof data?.message === "string" ? data.message : "";

  if (response.ok && data) {
    return {
      ok: true,
      valid: Boolean(data.valid),
      normalized: typeof data.normalized === "string" ? data.normalized : "",
      message,
    };
  }
  if (response.status === 401) {
    return { ok: false, state: "unauthorized", message: "Your session expired — sign in again." };
  }
  if (response.status === 429) {
    return {
      ok: false,
      state: "rate_limited",
      message: message || "Too many checks — please wait a moment.",
      retryAfterSecs: await readRetryAfter(response),
    };
  }
  return { ok: false, state: "error", message: message || "Something went wrong. Try again." };
}
