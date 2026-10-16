import { NextResponse } from "next/server";

import { rateLimit } from "@/lib/payment/rate-limit";
import { createQueue, ServiceError } from "@/lib/payment/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/payment-queues — create an ordered queue of payment QR codes.
 *
 * Body:
 * {
 *   "upiId": "name@bank",
 *   "payeeName": "Shop name",
 *   "note": "Invoice 001",              // optional
 *   "amountsPaise": [199900, 199900, 50200],
 *   "expiresInSecs": 900,               // optional, 60..7200
 *   "idempotencyKey": "uuid-v4"         // required — prevents double-create
 * }
 *
 * The same idempotency key always returns the same queue (never a second
 * set of identical orders).
 */
export async function POST(request: Request) {
  const limit = await rateLimit(request, "queueCreate");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many queue creations. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = body as Record<string, unknown>;

  try {
    const result = await createQueue({
      upiId: String(input.upiId ?? ""),
      payeeName: String(input.payeeName ?? ""),
      note: input.note === undefined || input.note === null ? undefined : String(input.note),
      amountsPaise: input.amountsPaise as number[],
      uniqueAmounts: input.uniqueAmounts === true,
      expiresInSecs: input.expiresInSecs === undefined ? undefined : Number(input.expiresInSecs),
      idempotencyKey: String(input.idempotencyKey ?? ""),
    });

    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "invalid" ? 400 : 409 });
    }
    console.error("[payment-queues] create failed:", error);
    return NextResponse.json({ error: "Could not create the payment queue." }, { status: 500 });
  }
}
