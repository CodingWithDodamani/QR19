import { NextResponse } from "next/server";

import { rateLimit } from "@/lib/payment/rate-limit";
import { overrideOrder, ServiceError } from "@/lib/payment/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/payment-queues/:id/orders/:orderId/override — staff override
 * for a single order.
 *
 * Body: { "action": "skip" | "cancel", "reason": "optional free text" }
 *
 * `skip` moves the pointer past the order WITHOUT labeling it paid
 * (status: skipped). Both actions are audit-logged.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const limit = rateLimit(request, "override");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const { id, orderId } = await params;

  let body: { action?: unknown; reason?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = body.action === "skip" || body.action === "cancel" ? body.action : null;
  if (!action) {
    return NextResponse.json(
      { error: 'action must be "skip" or "cancel".' },
      { status: 400 }
    );
  }

  try {
    const state = await overrideOrder(
      id,
      orderId,
      action,
      typeof body.reason === "string" ? body.reason : undefined
    );
    return NextResponse.json(state);
  } catch (error) {
    if (error instanceof ServiceError) {
      const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("[payment-queues] override failed:", error);
    return NextResponse.json({ error: "Could not override the order." }, { status: 500 });
  }
}
