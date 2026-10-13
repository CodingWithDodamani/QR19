import { NextResponse } from "next/server";

import { listQueueAlerts } from "@/lib/payment/fraud";
import { rateLimit } from "@/lib/payment/rate-limit";
import { getQueueState } from "@/lib/payment/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/payment-queues/:id/security — Fraud Shield state for a queue.
 *
 * Public (the queue id is a capability token, exactly like the queue state
 * endpoint) and rate-limited. Returns the active payment mode, whether that
 * mode is server-verified, the static anti-fraud guarantees the pipeline
 * enforces, and recent fraud alerts touching this queue.
 *
 * This is what powers the merchant-facing Fraud Shield panel on the
 * collection screen — the merchant's answer to "the customer is showing me
 * a payment screenshot".
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const limit = rateLimit(request, "queueSecurity");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Slow down." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const { id } = await params;
  const state = await getQueueState(id);
  if (!state) {
    return NextResponse.json({ error: "Queue not found." }, { status: 404 });
  }

  const alerts = await listQueueAlerts(id, 8);

  const guarantees = [
    {
      key: "unique-qr",
      text: "Every QR is a single-use order bound to its own reference, amount and expiry.",
    },
    {
      key: "amount-lock",
      text: "Even ₹1 short never completes a QR — the server checks the exact amount against the provider's report.",
    },
    {
      key: "no-screenshots",
      text: "Screenshots and SMS “proof” are never an input — only the payment provider's own confirmation can complete a QR.",
    },
    {
      key: "one-ref-one-order",
      text: "One provider transaction can verify exactly one QR. Reusing a payment proof for the next QR is blocked and alarmed.",
    },
  ];

  // Unique-amounts mode adds an extra layer: the amount itself is a
  // fingerprint for exactly one QR on this bill.
  if (state.queue.uniqueAmounts) {
    guarantees.push({
      key: "unique-amounts",
      text: "Every QR on this bill has a different amount — the amount that lands identifies exactly which QR was paid, so one proof can never cover two QRs.",
    });
  }

  return NextResponse.json(
    {
      mode: state.mode,
      // demo mode is explicitly NOT server-verified (simulated events);
      // every other mode verifies through a real PSP / signed webhook.
      serverVerified: state.mode !== "demo",
      alerts,
      guarantees,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
