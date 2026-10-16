import { NextResponse } from "next/server";

import { isAdminRequest, unauthorized } from "@/lib/payment/psp-auth";
import { rateLimit } from "@/lib/payment/rate-limit";
import { cancelQueue, ServiceError } from "@/lib/payment/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/payment-queues/:id/cancel — staff override: cancel the whole
 * session. Every still-payable order becomes `cancelled` (never `paid`)
 * and the action is written to the audit log.
 *
 * Body: { "reason": "optional free text" }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // P0-2: staff override — operator-only (ADMIN_TOKEN in prod).
  if (!isAdminRequest(request)) return unauthorized();

  const limit = await rateLimit(request, "override");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const { id } = await params;

  let reason: string | undefined;
  try {
    const body = (await request.json()) as { reason?: unknown };
    if (typeof body?.reason === "string") reason = body.reason;
  } catch {
    // Body is optional.
  }

  try {
    const state = await cancelQueue(id, reason);
    return NextResponse.json(state);
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "not_found" ? 404 : 409 });
    }
    console.error("[payment-queues] cancel failed:", error);
    return NextResponse.json({ error: "Could not cancel the queue." }, { status: 500 });
  }
}
