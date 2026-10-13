import { NextResponse } from "next/server";

import { rateLimit } from "@/lib/payment/rate-limit";
import { resolvePaymentMode } from "@/lib/payment/psp-settings";
import { ServiceError, simulateProviderEvent } from "@/lib/payment/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/payment-queues/:id/simulate — DEMO MODE ONLY.
 *
 * Generates a synthetic provider event and runs it through the exact same
 * idempotent processor as a live webhook. The UI labels every advance made
 * this way as a simulated payment — never a real one.
 *
 * Outcomes:
 * - success          → verified success for the current order (advances)
 * - wrong_amount     → success event with a mismatched amount (must NOT advance;
 *                      raises an AMOUNT_MISMATCH fraud alert)
 * - declined         → soft decline (QR stays active, non-blocking error)
 * - terminate        → provider closed the order (moves on)
 * - duplicate_success→ replays the previous success event id (idempotency)
 * - replayed_proof   → THE scam: presents the previous payment's provider
 *                      reference as a fresh success for the current order —
 *                      the duplicate-reference guard must block it and raise
 *                      a DUPLICATE_TXN_REF fraud alert
 *
 * In live mode this endpoint always answers 403.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const mode = await resolvePaymentMode();
  if (mode !== "demo") {
    return NextResponse.json(
      {
        error:
          mode === "razorpay-live"
            ? "Simulation is disabled: this collection verifies REAL payments."
            : "Simulation is disabled: a real payment provider is connected.",
      },
      { status: 403 }
    );
  }

  const limit = rateLimit(request, "simulate");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many simulations. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const { id } = await params;

  let body: { orderId?: unknown; outcome?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const outcomes = [
    "success",
    "wrong_amount",
    "declined",
    "terminate",
    "duplicate_success",
    "replayed_proof",
  ] as const;
  const outcome = outcomes.find((o) => o === body.outcome);
  if (!outcome || typeof body.orderId !== "string") {
    return NextResponse.json(
      { error: "orderId and a valid outcome are required." },
      { status: 400 }
    );
  }

  try {
    const result = await simulateProviderEvent({
      orderId: body.orderId,
      outcome,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ServiceError) {
      const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("[payment-queues] simulate failed:", error);
    return NextResponse.json({ error: "Simulation failed." }, { status: 500 });
  }
}
