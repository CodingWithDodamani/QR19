import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { isAdminRequest, unauthorized } from "@/lib/payment/psp-auth";
import { rateLimit } from "@/lib/payment/rate-limit";
import {
  maskedRecipients,
  notifyPaid,
  resolveWhatsAppConfig,
  whatsappStatus,
} from "@/lib/payment/whatsapp";

export const dynamic = "force-dynamic";

/** Console-added recipients (DB) — merged into status + the test send. */
async function dbRecipientNumbers(): Promise<string[]> {
  const rows = await db.whatsappRecipient.findMany({
    orderBy: { createdAt: "asc" },
    select: { number: true },
  });
  return rows.map((row) => row.number);
}

/**
 * GET  /api/psp/whatsapp-test — masked alerting status (mode, template,
 *      masked recipients). No secrets are ever returned.
 * POST /api/psp/whatsapp-test — send a real `payment_received` test alert to
 *      every configured recipient. In `demo` mode it logs without touching the
 *      network; in `off` (or live-but-misconfigured) it returns 409 so the
 *      console can show a clear "not configured" state.
 *
 * Both are ADMIN-gated (P0-2) and rate-limited — a live send costs real Meta
 * messages, so the bucket is intentionally tight (5/min/IP).
 */

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const limit = await rateLimit(request, "whatsappTest");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Slow down." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const dbRecipients = await dbRecipientNumbers();
  return NextResponse.json(whatsappStatus(dbRecipients));
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return unauthorized();

  const limit = await rateLimit(request, "whatsappTest");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many test alerts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  // Env recipients + console-added numbers (DB) both receive the test alert.
  const dbRecipients = await dbRecipientNumbers();
  const config = resolveWhatsAppConfig(dbRecipients);
  if (!config) {
    // off, or live-but-fail-closed. 409 = "not configured", not a server error.
    return NextResponse.json(
      { ...whatsappStatus(dbRecipients), sent: 0, failed: 0, message: "WhatsApp alerts are not configured." },
      { status: 409 }
    );
  }

  // Reuse the same fire-and-forget notifier the money path uses, pointed at a
  // fixed synthetic alert so operators can eyeball the template end-to-end.
  const result = await notifyPaid(
    {
      orderId: "TESTALERT",
      amountPaise: 199900, // ₹1,999.00 — the app's per-QR ceiling, an easy-to-spot figure.
      seq: 1,
      totalOrders: 3,
      provider: config.mode === "live" ? "live-test" : "demo-test",
      providerRef: "test_000000000000",
    },
    "webhook-test",
    config
  );

  return NextResponse.json({
    mode: config.mode,
    configured: true,
    templateName: config.templateName,
    languageCode: config.languageCode,
    recipients: maskedRecipients(config),
    sent: result.sent,
    failed: result.failed,
    message:
      config.mode === "live"
        ? `Test alert sent to ${result.sent} recipient(s); ${result.failed} failed.`
        : "Demo mode: nothing was sent to the network — check the server log for the rendered message.",
  });
}