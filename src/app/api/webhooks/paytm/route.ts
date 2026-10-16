import { createHash } from "crypto";

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { rateLimit } from "@/lib/payment/rate-limit";
import { recordFraudAlert } from "@/lib/payment/fraud";
import { paytmVerifyChecksum, rupeesStringToPaise } from "@/lib/payment/paytm";
import { getPspCredentials } from "@/lib/payment/psp-settings";
import { processProviderEvent } from "@/lib/payment/service";
import type { ProviderEvent } from "@/lib/payment/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/paytm — REAL Paytm Dynamic QR callback endpoint.
 *
 * DASHBOARD CONFIGURATION (Paytm developer docs):
 * 1. Sign in at the Paytm Business dashboard (business.paytm.com) and open
 *    the Webhook/Callback settings (Developer settings → Webhooks).
 * 2. Register `${this-origin}/api/webhooks/paytm` as the callback/webhook
 *    URL for Dynamic QR / order status notifications. Paytm posts the
 *    transaction status message to this URL.
 * 3. Verification uses the merchant's own Merchant Key via the `checksumhash`
 *    header (HMAC-SHA256 base64 over the exact raw body) — there is no
 *    separate webhook secret. Keep the Merchant Key saved in the PSP console.
 *
 * Documented callback contract (verified defensively):
 * - Header `checksumhash` = HMAC-SHA256(request body, merchantKey) in BASE64.
 *   Verified timing-safe over the exact raw bytes — nothing is trusted
 *   without it.
 * - Body: transaction status fields (v3 resultInfo / legacy UPPER_SNAKE are
 *   both tolerated). We map ONLY documented fields.
 *
 * Event mapping (documented fields only — nothing invented):
 * - TXN_SUCCESS → payment.success (orderId field; txnId ref; amount in
 *   RUPEES → converted to paise here).
 * - TXN_FAILURE → payment.failed (terminal true).
 * - PENDING / anything else → recorded only, no queue change.
 *
 * HONEST LIMIT: Paytm's dashboard has delivered callbacks in more than one
 * encoding across merchant cohorts. Verification is done against the exact
 * raw body bytes; if a delivery fails verification it is answered 401
 * (fail-closed, never trusted) and queues still advance through the
 * Transaction Status API polling fallback.
 *
 * Fail-closed: without active Paytm credentials this endpoint refuses to
 * process anything (403).
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
  if (!creds || creds.provider !== "paytm") {
    return NextResponse.json(
      {
        received: false,
        error:
          "No active Paytm credentials are configured in the PSP console. Connect Paytm (MID + Merchant Key) to enable callback verification.",
      },
      { status: 403 }
    );
  }

  const checksum = request.headers.get("checksumhash") ?? "";
  if (!paytmVerifyChecksum(checksum, rawBody, creds.keySecret)) {
    console.warn("[webhooks/paytm] rejected: invalid checksumhash");
    // Fraud Shield: a callback that fails checksum verification is either a
    // misconfigured merchant key or someone forging callbacks.
    await recordFraudAlert({
      type: "SIGNATURE_FAIL",
      severity: "low",
      message:
        "A Paytm callback was rejected — its checksumhash header did not verify against your Merchant Key. One row per provider; the count aggregates repeats. If this count keeps climbing, check the Merchant Key saved in the PSP console.",
      details: { provider: "paytm" },
      dedupeKey: "SIGNATURE_FAIL|paytm",
    });
    return NextResponse.json({ received: false, error: "Invalid signature." }, { status: 401 });
  }

  // Parse the (now verified) body — JSON first, form-encoded tolerated.
  let fields: Record<string, unknown>;
  try {
    fields = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    try {
      const params = new URLSearchParams(rawBody);
      fields = Object.fromEntries(params.entries());
    } catch {
      return NextResponse.json({ received: true, handled: false, reason: "invalid" }, { status: 200 });
    }
  }
  if (typeof fields !== "object" || fields === null) {
    return NextResponse.json({ received: true, handled: false, reason: "invalid" }, { status: 200 });
  }

  const info = (fields.resultInfo ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

  // v3 camelCase first, legacy UPPER_SNAKE as fallback.
  const resultStatus = str(info.resultStatus) ?? str(fields.resultStatus) ?? str(fields.STATUS) ?? "";
  const orderId =
    str(fields.orderId) ?? str(fields.ORDERID) ?? "";
  const txnId = str(fields.txnId) ?? str(fields.TXNID);
  const amountRupees = str(fields.txnAmount) ?? str(fields.TXNAMOUNT);

  // Deterministic id: same callback body replayed → same event id → deduped.
  const eventId = `paytm-cb-${orderId || "unknown"}-${resultStatus || "unknown"}-${createHash("sha256").update(rawBody, "utf8").digest("hex").slice(0, 24)}`;

  /* ------------------------- payment.success ------------------------ */
  if (resultStatus === "TXN_SUCCESS" && orderId) {
    const event: ProviderEvent = {
      eventId,
      type: "payment.success",
      orderId,
      amountPaise: amountRupees ? rupeesStringToPaise(amountRupees) : undefined,
      providerRef: txnId,
    };
    try {
      const result = await processProviderEvent(event, "webhook");
      return NextResponse.json({ received: true, ...result }, { status: 200 });
    } catch (error) {
      console.error("[webhooks/paytm] processing failed:", error);
      return NextResponse.json(
        { received: true, handled: false, error: "Processing error." },
        { status: 500 }
      );
    }
  }

  /* ------------------------- payment.failed ------------------------- */
  if (resultStatus === "TXN_FAILURE" && orderId) {
    const event: ProviderEvent = {
      eventId,
      type: "payment.failed",
      orderId,
      providerRef: txnId,
      terminal: true,
      reason: str(info.resultMsg) ?? str(fields.RESPMSG) ?? "paytm_txn_failure",
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
        kind: `paytm.${resultStatus || "unknown"}`,
        handled: false,
        reason: "ignored_type",
        payload: JSON.stringify({
          source: "webhook",
          resultStatus,
          orderId: orderId || null,
          txnId: txnId ?? null,
        }),
      },
    });
  } catch {
    // duplicate or ledger failure — the callback still answers 200
  }
  return NextResponse.json({ received: true, handled: false, reason: "ignored_type" }, { status: 200 });
}
