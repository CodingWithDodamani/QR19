import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { isAdminRequest, unauthorized } from "@/lib/payment/psp-auth";
import { rateLimit } from "@/lib/payment/rate-limit";
import {
  envRecipientNumbers,
  maskRecipient,
  normalizeRecipientDigits,
} from "@/lib/payment/whatsapp";

export const dynamic = "force-dynamic";

/**
 * GET  /api/psp/whatsapp-recipients — list console-added alert recipients
 *      (id + masked number, oldest first). Full numbers are never returned.
 * POST /api/psp/whatsapp-recipients — add one number, body { "number": "..." }.
 *      Full international format (8-15 digits; "+" and separators tolerated),
 *      stored in `WhatsappRecipient` and merged with env WHATSAPP_RECIPIENT at
 *      send time, so it receives the same `payment_received` template.
 *
 * ADMIN-gated (P0-2) + rate-limited (whatsappRecipients bucket). These numbers
 * only add recipients — WHATSAPP_ALERTS still decides off/demo/live.
 */

/** Hard cap so a typo loop cannot fill the table or the Meta send loop. */
const MAX_ADDED_RECIPIENTS = 20;

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const limit = await rateLimit(request, "whatsappRecipients");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Slow down." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const rows = await db.whatsappRecipient.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, number: true },
  });
  return NextResponse.json({
    recipients: rows.map((row) => ({ id: row.id, masked: maskRecipient(row.number) })),
  });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const limit = await rateLimit(request, "whatsappRecipients");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a minute." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  let body: { number?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const number = normalizeRecipientDigits(String(body.number ?? ""));
  if (!number) {
    return NextResponse.json(
      { error: "Enter a full international WhatsApp number (8-15 digits), e.g. 919876543210." },
      { status: 400 }
    );
  }

  // Already covered by the env list? Adding it again would only duplicate sends.
  if (envRecipientNumbers().includes(number)) {
    return NextResponse.json(
      { error: "This number is already configured in WHATSAPP_RECIPIENT." },
      { status: 409 }
    );
  }

  const [existing, count] = await Promise.all([
    db.whatsappRecipient.findUnique({ where: { number }, select: { id: true } }),
    db.whatsappRecipient.count(),
  ]);
  if (existing) {
    return NextResponse.json({ error: "This number was already added." }, { status: 409 });
  }
  if (count >= MAX_ADDED_RECIPIENTS) {
    return NextResponse.json(
      { error: `The added-number list is full (${MAX_ADDED_RECIPIENTS}). Remove one before adding another.` },
      { status: 400 }
    );
  }

  const row = await db.whatsappRecipient.create({ data: { number } });
  return NextResponse.json(
    { added: true, recipient: { id: row.id, masked: maskRecipient(row.number) } },
    { status: 201 }
  );
}