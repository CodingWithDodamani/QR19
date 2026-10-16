import { NextResponse } from "next/server";

import { rateLimit } from "@/lib/payment/rate-limit";
import { resolvePaymentMode } from "@/lib/payment/psp-settings";
import { getQueueState, pollCurrentOrderPayments } from "@/lib/payment/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/payment-queues/:id/verify-now — merchant-initiated re-check.
 *
 * The counter-move to "payment ho gaya, screenshot dekho": instead of
 * trusting the customer's claim (or a screenshot), the merchant taps
 * "Verify payment now" and THIS server asks the payment provider directly
 * (Razorpay / PhonePe / Paytm status APIs) whether the current QR is
 * actually paid. The response is definitive and honest either way:
 * - verified  → the provider confirmed the money; the queue advances.
 * - not yet   → "do not hand over goods until this screen shows VERIFIED."
 * - demo mode → honest answer that there is no real provider to check.
 *
 * Runs the exact same poll path as the automatic heartbeat, so a confirmed
 * payment flows through the standard verified processor (idempotent,
 * amount-checked, duplicate-ref-guarded).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const limit = await rateLimit(request, "verifyNow");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many checks. Try again in a few seconds." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const { id } = await params;
  const state = await getQueueState(id);
  if (!state) {
    return NextResponse.json({ error: "Queue not found." }, { status: 404 });
  }

  const mode = await resolvePaymentMode();
  if (mode === "demo") {
    return NextResponse.json({
      mode,
      checked: false,
      verified: false,
      message:
        "DEMO mode — there is no real payment provider to check against. Use the demo console's Simulate payment button to exercise the pipeline.",
    });
  }

  const before = state.paidCount;
  await pollCurrentOrderPayments(id);
  const fresh = await getQueueState(id);
  const verified = (fresh?.paidCount ?? 0) > before;

  if (verified) {
    return NextResponse.json({
      mode,
      checked: true,
      verified: true,
      message: "Verified: the provider confirmed this payment. The queue has advanced.",
    });
  }

  if (!fresh?.current) {
    return NextResponse.json({
      mode,
      checked: true,
      verified: false,
      message: "Nothing left to verify — every payable QR in this session is settled.",
    });
  }

  return NextResponse.json({
    mode,
    checked: true,
    verified: false,
    message:
      "No completed payment found for the current QR yet. Do NOT hand over goods until this screen shows the VERIFIED (PAID) stamp — a customer screenshot is not proof.",
  });
}
