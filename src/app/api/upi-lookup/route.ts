import { NextResponse, type NextRequest } from "next/server";

import { rateLimit, rateLimitKeyed } from "@/lib/payment/rate-limit";
import { maskPhone, normalizeIndianMobile } from "@/lib/upi-lookup/phone";
import {
  DEMO_TEST_NUMBERS,
  getLookupProvider,
  ProviderUnavailableError,
} from "@/lib/upi-lookup/provider";
import { getSessionFromRequest } from "@/lib/upi-lookup/session";

export const dynamic = "force-dynamic";

/**
 * Recipient discovery (mobile-number → UPI recipient).
 *
 * GET  → capability/mode descriptor (public; no personal data).
 * POST → lookup, requires an authenticated session. Explicit user action
 *        happens in the UI before this is ever called (never on keystroke).
 *
 * Anti-abuse: per-IP AND per-session rate limits; only masked values are
 * ever logged; nothing about a lookup is persisted.
 */

const DEMO_DISCLAIMER =
  "DEMO data — synthetic result for testing, not a real UPI match.";
const LIVE_DISCLAIMER =
  "Resolved by your payment service provider. The name is shown as returned by the provider and is not proof of identity.";

export async function GET() {
  const provider = getLookupProvider();
  return NextResponse.json({
    mode: provider.mode,
    capabilities: { mobileNumberLookup: provider.supportsMobileLookup },
    unsupportedReason: provider.unsupportedReason,
    demo:
      provider.mode === "demo"
        ? {
            testNumbers: DEMO_TEST_NUMBERS,
            failureNumber: "99999 0009",
            note: "Synthetic directory — other numbers return “not found”. 99999 0009 simulates a provider outage.",
          }
        : null,
  });
}

export async function POST(request: NextRequest) {
  // 1. Authentication is required (no anonymous enumeration).
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "unauthorized", message: "Sign in before looking up recipients." },
      { status: 401 }
    );
  }

  // 2. Rate limits — per IP and per session (anti bulk-lookup / harvesting).
  const ipLimit = rateLimit(request, "lookup");
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many lookups from this network." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSecs) } }
    );
  }
  const sessionLimit = rateLimitKeyed("lookupSession", session.sid);
  if (!sessionLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many lookups. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(sessionLimit.retryAfterSecs) } }
    );
  }

  // 3. Validate + normalize the number.
  let rawPhone: unknown;
  try {
    const body = (await request.json()) as { phone?: unknown };
    rawPhone = body?.phone;
  } catch {
    return NextResponse.json(
      { error: "invalid_input", message: "Invalid request body." },
      { status: 400 }
    );
  }
  const normalized = normalizeIndianMobile(rawPhone);
  if (!normalized.ok) {
    return NextResponse.json(
      { error: "invalid_input", message: normalized.error },
      { status: 400 }
    );
  }
  const phone = normalized.value;

  // 4. Resolve through the provider adapter.
  const provider = getLookupProvider();

  if (!provider.supportsMobileLookup) {
    // Honest "unsupported" answer — e.g. live mode without an approved
    // number-resolution API. The UI renders this as its own state.
    return NextResponse.json(
      {
        error: "lookup_unsupported",
        message:
          provider.unsupportedReason ??
          "This provider does not support mobile-number lookup.",
      },
      { status: 501 }
    );
  }

  const startedAt = Date.now();
  try {
    const outcome = await provider.lookup(phone);

    // Privacy: log neither the number nor the name — result shape only.
    console.log(
      `[upi-lookup] mode=${provider.mode} result=${outcome.kind} tookMs=${Date.now() - startedAt}`
    );

    if (outcome.kind === "not_found") {
      return NextResponse.json({
        mode: provider.mode,
        disclaimer: provider.mode === "demo" ? DEMO_DISCLAIMER : LIVE_DISCLAIMER,
        result: { kind: "not_found" as const },
      });
    }

    return NextResponse.json({
      mode: provider.mode,
      disclaimer: provider.mode === "demo" ? DEMO_DISCLAIMER : LIVE_DISCLAIMER,
      result: {
        kind: "found" as const,
        payeeName: outcome.payeeName,
        upiId: outcome.upiId,
        recipientToken: outcome.recipientToken,
        queriedMobileMasked: maskPhone(phone),
      },
    });
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      console.log(`[upi-lookup] mode=${provider.mode} result=provider_unavailable`);
      return NextResponse.json(
        { error: "provider_unavailable", message: error.message, retryable: true },
        { status: 503 }
      );
    }
    console.error("[upi-lookup] unexpected provider error:", error);
    return NextResponse.json(
      { error: "provider_unavailable", message: "Lookup failed unexpectedly.", retryable: true },
      { status: 503 }
    );
  }
}
