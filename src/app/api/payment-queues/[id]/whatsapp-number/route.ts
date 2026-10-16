import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { rateLimit } from "@/lib/payment/rate-limit";
import { normalizeRecipientDigits, maskRecipient } from "@/lib/payment/whatsapp";

export const dynamic = "force-dynamic";

/**
 * GET  /api/payment-queues/[id]/whatsapp-number — return the saved WhatsApp
 *      number (masked) + alerts-enabled flag for this queue, or null.
 * POST /api/payment-queues/[id]/whatsapp-number — save a WhatsApp number and/
 *      or toggle the alerts switch for this queue. Body:
 *      { "number": "+919876543210", "alertsEnabled": true } (both optional).
 *      No admin token needed — the merchant saving their own number on their
 *      own queue is self-service (mobile Profile card → auto-synced at
 *      "Start collecting").
 *
 * This is separate from the PSP console's ADMIN-gated recipient list: the
 * console manages operator-level recipients, while this endpoint lets the
 * merchant attach ONE per-queue number that receives alerts for that queue only.
 *
 * The number is stored on the `PaymentQueue.whatsappNumber` field together
 * with the enable switch on `PaymentQueue.whatsappAlerts`; at payment time
 * `notifyPaid()` includes an enabled queue's number ALWAYS (demo-log when
 * env WHATSAPP_ALERTS is unset; merged with env + console numbers when set).
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const limit = await rateLimit(request, "queueState");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const queue = await db.paymentQueue.findUnique({
    where: { id },
    select: { whatsappNumber: true, whatsappAlerts: true },
  });
  if (!queue) {
    return NextResponse.json({ error: "Queue not found." }, { status: 404 });
  }

  return NextResponse.json({
    number: queue.whatsappNumber ? maskRecipient(queue.whatsappNumber) : null,
    saved: Boolean(queue.whatsappNumber),
    alertsEnabled: queue.whatsappAlerts,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const limit = await rateLimit(request, "queueCreate");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  let body: { number?: unknown; alertsEnabled?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Toggle-only request ({ alertsEnabled: true|false }) — number untouched.
  if (typeof body.alertsEnabled === "boolean" && body.number === undefined) {
    const queue = await db.paymentQueue.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!queue) {
      return NextResponse.json({ error: "Queue not found." }, { status: 404 });
    }
    const updated = await db.paymentQueue.update({
      where: { id },
      data: { whatsappAlerts: body.alertsEnabled },
    });
    return NextResponse.json({
      saved: Boolean(updated.whatsappNumber),
      number: updated.whatsappNumber ? maskRecipient(updated.whatsappNumber) : null,
      alertsEnabled: updated.whatsappAlerts,
    });
  }

  const raw = String(body.number ?? "");
  // Allow clearing
  if (!raw.trim()) {
    const updated = await db.paymentQueue.update({
      where: { id },
      data: {
        whatsappNumber: null,
        // A toggle with no number can never send; reset it so the stored
        // state never claims to be on while effectively inert.
        whatsappAlerts: false,
      },
    });
    return NextResponse.json({
      saved: false,
      number: null,
      alertsEnabled: updated.whatsappAlerts,
    });
  }

  const normalized = normalizeRecipientDigits(raw);
  if (!normalized) {
    return NextResponse.json(
      {
        error:
          "Enter a valid WhatsApp number with country code (8-15 digits), e.g. +919876543210.",
      },
      { status: 400 }
    );
  }

  const queue = await db.paymentQueue.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!queue) {
    return NextResponse.json({ error: "Queue not found." }, { status: 404 });
  }

  const updated = await db.paymentQueue.update({
    where: { id },
    data: {
      whatsappNumber: normalized,
      ...(typeof body.alertsEnabled === "boolean" ? { whatsappAlerts: body.alertsEnabled } : {}),
    },
  });

  return NextResponse.json({
    saved: true,
    number: maskRecipient(normalized),
    alertsEnabled: updated.whatsappAlerts,
  });
}
