import { createHmac, timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { rateLimit } from "@/lib/payment/rate-limit";
import { getPspCredentials } from "@/lib/payment/psp-settings";
import { recordFraudAlert } from "@/lib/payment/fraud";
import { processProviderEvent } from "@/lib/payment/service";
import type { ProviderEvent } from "@/lib/payment/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/razorpay — REAL Razorpay webhook endpoint.
 *
 * Configure this URL in the Razorpay dashboard (Account & Settings →
 * Webhooks → Add New Webhook) together with a webhook secret, then paste
 * the same secret into the app's PSP console. Per Razorpay's documented
 * contract (https://razorpay.com/docs/webhooks/validate-test/):
 *
 * - Signature: `X-Razorpay-Signature` header = HMAC-SHA256 (hex) of the
 *   RAW request body keyed with the webhook secret. Verified timing-safe
 *   over the exact bytes — nothing is trusted without it.
 * - Idempotency: duplicate deliveries carry the same `x-razorpay-event-id`.
 * - Delivery contract: 2XX within 5s; failures retried for 24h.
 *
 * Event mapping (documented webhook payloads only — nothing invented):
 * - qr_code.credited → payment.success for the order that owns the QR
 *   (payload.payment.entity + payload.qr_code.entity.id; the QR's notes —
 *   including our orderId — are echoed onto the payment).
 * - payment.captured → payment.success correlated through the echoed
 *   notes.orderId (used when the QR entity is absent).
 * - payment.failed   → payment.failed (soft decline; the QR stays active).
 * - qr_code.closed   → recorded, not acted on (our own expiry reaper owns
 *   auto-expiry; this event fires on manual closes only).
 *
 * Fail-closed: without a configured webhook secret this endpoint refuses
 * to process anything (403) — the polling fallback keeps queues moving.
 */

interface RazorpayWebhookBody {
  event?: string;
  contains?: string[];
  payload?: {
    payment?: { entity?: Record<string, unknown> };
    qr_code?: { entity?: Record<string, unknown> };
  };
  created_at?: number;
}

function pickString(entity: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = entity?.[key];
  return typeof value === "string" ? value : undefined;
}

function pickNumber(entity: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = entity?.[key];
  return typeof value === "number" ? value : undefined;
}

function pickNotes(entity: Record<string, unknown> | undefined): Record<string, string> {
  const notes = entity?.notes;
  if (typeof notes !== "object" || notes === null) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(notes as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Persist an event that could not be mapped to an order, so the console
 *  monitor still shows the real webhook traffic (redacted whitelist). */
async function recordUnmappedEvent(
  eventId: string,
  kind: string,
  reason: string,
  detail: Record<string, unknown>
): Promise<void> {
  try {
    await db.webhookEvent.create({
      data: {
        id: eventId,
        kind,
        handled: false,
        reason,
        payload: JSON.stringify(detail),
      },
    });
  } catch {
    // duplicate or ledger failure — the webhook still answers 200
  }
}

export async function POST(request: Request) {
  const limit = rateLimit(request, "webhook");
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
  if (!creds || creds.provider !== "razorpay") {
    return NextResponse.json(
      {
        received: false,
        error: !creds
          ? "No Razorpay credentials are configured in the PSP console. Save your keys there to enable webhook verification."
          : "The PSP console currently has a different provider active (PhonePe/Paytm). Razorpay webhooks are only processed while Razorpay is the connected provider.",
      },
      { status: 403 }
    );
  }
  const secret = creds.webhookSecret;
  const signature = request.headers.get("x-razorpay-signature") ?? "";

  if (!secret) {
    return NextResponse.json(
      {
        received: false,
        error:
          "No Razorpay webhook secret is configured in the PSP console. Set it there (same value as in the Razorpay dashboard) to enable webhook verification.",
      },
      { status: 403 }
    );
  }

  // Timing-safe HMAC-SHA256 over the exact raw bytes (Razorpay contract).
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    console.warn("[webhooks/razorpay] rejected: invalid signature");
    // Fraud Shield: a delivery that fails HMAC verification is either a
    // misconfigured dashboard secret or someone forging webhook events.
    // Bounded ledger row (one per provider, count aggregates).
    await recordFraudAlert({
      type: "SIGNATURE_FAIL",
      severity: "low",
      message:
        "A Razorpay webhook delivery was rejected — its X-Razorpay-Signature did not verify against the secret saved in the PSP console. One row per provider; the count aggregates repeats. If this count keeps climbing, check that the dashboard webhook secret matches the console.",
      details: { provider: "razorpay" },
      dedupeKey: "SIGNATURE_FAIL|razorpay",
    });
    return NextResponse.json({ received: false, error: "Invalid signature." }, { status: 401 });
  }

  let parsed: RazorpayWebhookBody;
  try {
    parsed = JSON.parse(rawBody) as RazorpayWebhookBody;
  } catch {
    return NextResponse.json({ received: true, handled: false, reason: "invalid" }, { status: 200 });
  }

  // Idempotency: prefer Razorpay's per-event id header; fall back to a
  // stable digest derived from the body.
  const headerEventId = request.headers.get("x-razorpay-event-id");
  const eventId =
    headerEventId?.trim() ||
    `rzp-${parsed.event ?? "unknown"}-${parsed.created_at ?? 0}-${createHmac("sha256", "evt-id").update(rawBody).digest("hex").slice(0, 24)}`;

  const eventType = parsed.event ?? "";
  const paymentEntity = parsed.payload?.payment?.entity;
  const qrEntity = parsed.payload?.qr_code?.entity;

  /* --------------------- ignored / recorded-only events ------------- */
  if (eventType === "qr_code.created") {
    return NextResponse.json({ received: true, handled: false, reason: "ignored_type" }, { status: 200 });
  }
  if (eventType === "qr_code.closed") {
    await recordUnmappedEvent(eventId, eventType, "ignored_type", {
      qrId: pickString(qrEntity, "id") ?? null,
    });
    return NextResponse.json({ received: true, handled: false, reason: "ignored_type" }, { status: 200 });
  }

  /* ------------------------- payment.failed ------------------------- */
  if (eventType === "payment.failed") {
    const notes = pickNotes(paymentEntity);
    const orderId = notes.orderId ?? "";
    const event: ProviderEvent = {
      eventId,
      type: "payment.failed",
      orderId,
      providerRef: pickString(paymentEntity, "id"),
      terminal: false,
      reason: pickString(paymentEntity, "error_description") ?? "declined_by_provider",
    };
    const result = await processProviderEvent(event, "webhook").catch(() => ({
      handled: false,
      reason: "invalid" as const,
    }));
    return NextResponse.json({ received: true, ...result }, { status: 200 });
  }

  /* -------------- payment.success via qr_code.credited -------------- */
  // Primary, QR-aware event: payload carries BOTH the payment and the QR.
  if (eventType === "qr_code.credited") {
    const status = pickString(paymentEntity, "status");
    const amount = pickNumber(paymentEntity, "amount");
    const notes = pickNotes(paymentEntity);
    const qrId = pickString(qrEntity, "id");

    // Locate the order by the QR id (authoritative) or the echoed notes.
    let orderId = notes.orderId ?? "";
    if (qrId) {
      const match = await db.paymentOrder.findFirst({
        where: { providerQrId: qrId },
        select: { orderId: true },
      });
      if (match) orderId = match.orderId;
    }

    if (!orderId) {
      await recordUnmappedEvent(eventId, eventType, "unknown_order", {
        qrId: qrId ?? null,
        notes,
      });
      return NextResponse.json({ received: true, handled: false, reason: "unknown_order" }, { status: 200 });
    }

    if (status !== "captured") {
      // Only captured money may advance a queue — anything else is recorded
      // and ignored (Razorpay fires credited after capture; stay strict).
      await recordUnmappedEvent(eventId, eventType, "not_captured", {
        status: status ?? null,
        orderId,
      });
      return NextResponse.json({ received: true, handled: false, reason: "not_captured" }, { status: 200 });
    }

    const event: ProviderEvent = {
      eventId,
      type: "payment.success",
      orderId,
      amountPaise: amount,
      providerRef: pickString(paymentEntity, "id"),
    };
    try {
      const result = await processProviderEvent(event, "webhook");
      return NextResponse.json({ received: true, ...result }, { status: 200 });
    } catch (error) {
      console.error("[webhooks/razorpay] processing failed:", error);
      return NextResponse.json(
        { received: true, handled: false, error: "Processing error." },
        { status: 500 }
      );
    }
  }

  /* --------- payment.captured / authorized via echoed notes --------- */
  if (eventType === "payment.captured" || eventType === "payment.authorized") {
    const notes = pickNotes(paymentEntity);
    const orderId = notes.orderId ?? "";
    if (!orderId) {
      await recordUnmappedEvent(eventId, eventType, "unknown_order", {
        paymentId: pickString(paymentEntity, "id") ?? null,
      });
      return NextResponse.json({ received: true, handled: false, reason: "unknown_order" }, { status: 200 });
    }
    if (eventType === "payment.authorized") {
      // Authorized but not yet captured — never advances a queue.
      await recordUnmappedEvent(eventId, eventType, "not_captured", { orderId });
      return NextResponse.json({ received: true, handled: false, reason: "not_captured" }, { status: 200 });
    }

    const event: ProviderEvent = {
      eventId,
      type: "payment.success",
      orderId,
      amountPaise: pickNumber(paymentEntity, "amount"),
      providerRef: pickString(paymentEntity, "id"),
    };
    try {
      const result = await processProviderEvent(event, "webhook");
      return NextResponse.json({ received: true, ...result }, { status: 200 });
    } catch (error) {
      console.error("[webhooks/razorpay] processing failed:", error);
      return NextResponse.json(
        { received: true, handled: false, error: "Processing error." },
        { status: 500 }
      );
    }
  }

  // Everything else: acknowledge so Razorpay stops retrying, record for the
  // monitor, and make no state change.
  await recordUnmappedEvent(eventId, eventType || "unknown", "ignored_type", {});
  return NextResponse.json({ received: true, handled: false, reason: "ignored_type" }, { status: 200 });
}
