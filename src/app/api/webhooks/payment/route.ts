import { createHmac, timingSafeEqual } from "crypto";

import { NextResponse } from "next/server";

import { getPaymentMode } from "@/lib/payment/config";
import { rateLimit } from "@/lib/payment/rate-limit";
import { processProviderEvent } from "@/lib/payment/service";
import type { ProviderEvent } from "@/lib/payment/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/payment — live PSP webhook endpoint.
 *
 * Security model:
 * - The raw request body is verified as HMAC-SHA256 (hex) under the
 *   `x-payment-signature` header, keyed by PAYMENT_WEBHOOK_SECRET.
 *   Comparison is timing-safe. Without a valid signature nothing is
 *   trusted or recorded — and in demo mode this endpoint refuses to
 *   process anything (403), so a screen can never be advanced by a
 *   forged local request.
 * - The client NEVER calls this route; only the PSP does.
 *
 * Documented event contract (whitelist — everything else is dropped):
 * {
 *   "eventId":     "evt_01H...",          // unique per delivery (idempotency)
 *   "type":        "payment.success" | "payment.failed" | "order.terminated",
 *   "orderId":     "ON99XXXXXXXX01",      // our order reference (UPI `tr`)
 *   "amountPaise": 199900,                // must match the order exactly
 *   "providerRef": "pay_...",              // PSP transaction reference
 *   "reason":      "declined_by_bank",    // optional, failures only
 *   "terminal":    false                  // payment.failed only: PSP closed the order
 * }
 *
 * Responses: 200 {received, handled, reason} — PSPs retry on non-2xx, so
 * business-level rejections still answer 200 with handled:false.
 */
export async function POST(request: Request) {
  const limit = await rateLimit(request, "webhook");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many webhook deliveries." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const mode = getPaymentMode();

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ received: false, error: "Unreadable body." }, { status: 400 });
  }

  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  const signature = request.headers.get("x-payment-signature") ?? "";

  if (mode !== "live" || !secret) {
    // Demo mode: this endpoint is deliberately inert. Advances must only
    // come through the labeled demo simulator.
    return NextResponse.json(
      {
        received: false,
        error:
          "Webhook processing is disabled: no PAYMENT_WEBHOOK_SECRET is configured (demo mode).",
      },
      { status: 403 }
    );
  }

  // Timing-safe signature check over the exact raw bytes.
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    console.warn("[webhooks/payment] rejected: invalid signature");
    return NextResponse.json({ received: false, error: "Invalid signature." }, { status: 401 });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ received: true, handled: false, reason: "invalid" }, { status: 200 });
  }

  const event: ProviderEvent = {
    eventId: typeof parsed.eventId === "string" ? parsed.eventId : "",
    type: typeof parsed.type === "string" ? parsed.type : "",
    orderId: typeof parsed.orderId === "string" ? parsed.orderId : "",
    amountPaise:
      parsed.amountPaise === undefined || parsed.amountPaise === null
        ? undefined
        : Number(parsed.amountPaise),
    providerRef: typeof parsed.providerRef === "string" ? parsed.providerRef : undefined,
    terminal: typeof parsed.terminal === "boolean" ? parsed.terminal : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : undefined,
  };

  try {
    const result = await processProviderEvent(event, "webhook");
    return NextResponse.json({ received: true, ...result }, { status: 200 });
  } catch (error) {
    console.error("[webhooks/payment] processing failed:", error);
    // 500 so the PSP retries later (transient DB issues, etc.).
    return NextResponse.json({ received: true, handled: false, error: "Processing error." }, { status: 500 });
  }
}
