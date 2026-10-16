import { NextResponse } from "next/server";

import { rateLimit } from "@/lib/payment/rate-limit";
import { getQueueState } from "@/lib/payment/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/payment-queues/:id — authoritative queue snapshot.
 *
 * Used for initial load and resync (SSE reconnect, tab resume). The client
 * never derives "payment succeeded" from polling this endpoint; it only
 * replaces its local view with this server truth.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const limit = await rateLimit(request, "queueState");
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
  return NextResponse.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}
