import { createHash } from "crypto";

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { rateLimit } from "@/lib/payment/rate-limit";
import { recordFraudAlert } from "@/lib/payment/fraud";
import { phonepeDecodeCallback, phonepeVerifyCallback } from "@/lib/payment/phonepe";
import { getPspCredentials } from "@/lib/payment/psp-settings";
import { processProviderEvent } from "@/lib/payment/service";
import type { ProviderEvent } from "@/lib/payment/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/phonepe — REAL PhonePe PG v1 callback endpoint.
 *
 * DASHBOARD CONFIGURATION (PhonePe Business developer docs):
 * 1. Sign in at the PhonePe Business dashboard (merchant.phonepe.com).
 * 2. The callback URL is sent PER REQUEST in the Pay API payload's
 *    `callbackUrl` field — this app fills it automatically with
 *    `${APP_ORIGIN}/api/webhooks/phonepe` when provisioning each order
 *    (set APP_ORIGIN to this deployment's public https URL; PhonePe
 *    refuses localhost/private URLs, the status-API polling fallback
 *    keeps queues moving without it).
 * 3. Verification uses the merchant's own Salt Key + Salt Index — there is
 *    no separate webhook secret. Keep the Salt Key saved in the PSP console.
 *
 * Documented callback contract:
 * - Body: base64 of a status-check-style response JSON.
 * - Header `X-VERIFY` = sha256(base64Body + saltKey) + "###" + saltIndex
 *   (sha256 lowercase hex, no API path in the middle). Verified timing-safe
 *   over the exact bytes — nothing is trusted without it.
 *
 * Event mapping (documented fields only — nothing invented):
 * - data.state === "COMPLETED" → payment.success (amountPaise = data.amount
 *   in PAISE, providerRef = data.transactionId, orderId =
 *   data.merchantTransactionId — our order reference).
 * - data.state === "FAILED"    → payment.failed (terminal true).
 * - CHECKING / PENDING / anything else → recorded only, no queue change.
 *
 * Fail-closed: without active PhonePe credentials this endpoint refuses to
 * process anything (403) — the polling fallback keeps queues moving.
 * PhonePe always receives a well-formed answer (200) for accepted
 * deliveries; 401/403 are returned only for real auth problems.
 */
export async function POST(request: Request) {
  const limit = await rateLimit(request, "webhook");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many webhook deliveries." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ received: false, error: "Unreadable body." }, { status: 400 });
  }

  const creds = await getPspCredentials().catch(() => null);
  if (!creds || creds.provider !== "phonepe") {
    return NextResponse.json(
      {
        received: false,
        error:
          "No active PhonePe credentials are configured in the PSP console. Connect PhonePe (Merchant ID + Salt Key + Salt Index) to enable callback verification.",
      },
      { status: 403 }
    );
  }

  const xVerify = request.headers.get("x-verify") ?? "";
  if (!phonepeVerifyCallback(rawBody, xVerify, creds.keySecret, creds.saltIndex)) {
    console.warn("[webhooks/phonepe] rejected: invalid X-VERIFY");
    // Fraud Shield: a callback that fails X-VERIFY verification is either a
    // misconfigured salt key or someone forging callbacks.
    await recordFraudAlert({
      type: "SIGNATURE_FAIL",
      severity: "low",
      message:
        "A PhonePe callback was rejected — its X-VERIFY header did not verify against your Salt Key + Salt Index. One row per provider; the count aggregates repeats. If this count keeps climbing, check the Salt Key/Salt Index saved in the PSP console.",
      details: { provider: "phonepe" },
      dedupeKey: "SIGNATURE_FAIL|phonepe",
    });
    return NextResponse.json({ received: false, error: "Invalid signature." }, { status: 401 });
  }

  const decoded = phonepeDecodeCallback(rawBody);
  if (!decoded) {
    return NextResponse.json({ received: true, handled: false, reason: "invalid" }, { status: 200 });
  }

  const data = decoded.data ?? {};
  const orderId = typeof data.merchantTransactionId === "string" ? data.merchantTransactionId : "";
  const state = typeof data.state === "string" ? data.state : "";
  const transactionId = typeof data.transactionId === "string" ? data.transactionId : undefined;

  // Deterministic id: same callback body replayed → same event id → deduped.
  const eventId = `phonepe-cb-${orderId || "unknown"}-${state || "unknown"}-${createHash("sha256").update(rawBody, "utf8").digest("hex").slice(0, 24)}`;

  /* ------------------------- payment.success ------------------------ */
  if (state === "COMPLETED" && orderId) {
    const event: ProviderEvent = {
      eventId,
      type: "payment.success",
      orderId,
      amountPaise: typeof data.amount === "number" ? data.amount : undefined,
      providerRef: transactionId,
    };
    try {
      const result = await processProviderEvent(event, "webhook");
      return NextResponse.json({ received: true, ...result }, { status: 200 });
    } catch (error) {
      console.error("[webhooks/phonepe] processing failed:", error);
      return NextResponse.json(
        { received: true, handled: false, error: "Processing error." },
        { status: 500 }
      );
    }
  }

  /* ------------------------- payment.failed ------------------------- */
  if (state === "FAILED" && orderId) {
    const event: ProviderEvent = {
      eventId,
      type: "payment.failed",
      orderId,
      providerRef: transactionId,
      terminal: true,
      reason: typeof data.responseCode === "string" ? data.responseCode : "phonepe_status_failed",
    };
    const result = await processProviderEvent(event, "webhook").catch(() => ({
      handled: false,
      reason: "invalid" as const,
    }));
    return NextResponse.json({ received: true, ...result }, { status: 200 });
  }

  /* ---------------- recorded-only (non-terminal states) -------------- */
  try {
    await db.webhookEvent.create({
      data: {
        id: eventId,
        orderId: orderId || null,
        kind: `phonepe.${state || "unknown"}`,
        handled: false,
        reason: "ignored_type",
        payload: JSON.stringify({
          source: "webhook",
          state,
          orderId: orderId || null,
          transactionId: transactionId ?? null,
        }),
      },
    });
  } catch {
    // duplicate or ledger failure — the callback still answers 200
  }
  return NextResponse.json({ received: true, handled: false, reason: "ignored_type" }, { status: 200 });
}
