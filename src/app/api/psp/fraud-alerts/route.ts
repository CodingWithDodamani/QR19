import { NextResponse } from "next/server";

import { listFraudAlerts } from "@/lib/payment/fraud";
import { sessionFromRequest, unauthorized } from "@/lib/payment/psp-auth";
import { rateLimit } from "@/lib/payment/rate-limit";

export const dynamic = "force-dynamic";

/**
 * GET /api/psp/fraud-alerts — operator-only Fraud Shield feed.
 *
 * Session-gated (same signed-session gate as the rest of the PSP console):
 * alert messages describe payment behavior and are merchant-safe, but the
 * full ledger still belongs behind the operator gate. Returns the most
 * recent alerts (deduped rows with aggregate counts) plus a severity
 * summary for the console badge.
 */
export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return unauthorized();

  const limit = rateLimit(request, "pspFraudAlerts");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Slow down." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const alerts = await listFraudAlerts(50);
  const summary = alerts.reduce(
    (acc, alert) => {
      acc[alert.severity] += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0 }
  );

  return NextResponse.json(
    { alerts, summary },
    { headers: { "Cache-Control": "no-store" } }
  );
}
