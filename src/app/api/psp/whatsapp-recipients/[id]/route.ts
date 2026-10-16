import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { isAdminRequest, unauthorized } from "@/lib/payment/psp-auth";
import { rateLimit } from "@/lib/payment/rate-limit";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/psp/whatsapp-recipients/:id — remove one console-added alert
 *        recipient. ADMIN-gated (P0-2) + rate-limited. Env-configured
 *        recipients (WHATSAPP_RECIPIENT) are not stored here and cannot be
 *        removed through this endpoint.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(request)) return unauthorized();

  const limit = await rateLimit(request, "whatsappRecipients");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a minute." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const { id } = await params;
  const result = await db.whatsappRecipient.deleteMany({ where: { id } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
  }
  return NextResponse.json({ removed: true });
}