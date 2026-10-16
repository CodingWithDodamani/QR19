import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { isAdminRequest, unauthorized } from "@/lib/payment/psp-auth";
import { rateLimit } from "@/lib/payment/rate-limit";
import { resolvePaymentMode } from "@/lib/payment/psp-settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/psp/events — live monitor feed for the PSP console
 * (session-gated; contains no secrets).
 *
 * Merges the two honest ledgers the app already keeps:
 * - WebhookEvent: every provider event that reached the verified processor
 *   (webhook, poll fallback, demo simulator) with its outcome.
 * - AuditLog: PSP QR provisioning attempts (created / failed).
 *
 * Synthetic payments are clearly flagged: demo simulations carry a
 * `demo-…` providerRef and webhook-test deliveries a `pay_synthtest_…`
 * prefix — the console renders them as SIMULATED, never as real money.
 */

interface EventItem {
  id: string;
  kind: string;
  at: string;
  source: "webhook" | "poll" | "demo" | "synthetic" | "system" | "unknown";
  orderId?: string;
  amountPaise?: number;
  providerRef?: string;
  handled?: boolean;
  reason?: string;
}

export async function GET(request: Request) {
  // P0-2: operator-only — ADMIN_TOKEN bearer in prod, demo session locally.
  if (!isAdminRequest(request)) return unauthorized();

  const limit = await rateLimit(request, "pspEvents");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many monitor refreshes." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const mode = await resolvePaymentMode();
  const [webhookEvents, provisioning] = await Promise.all([
    db.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 30 }),
    db.auditLog.findMany({
      where: { action: { in: ["provider_qr_created", "provider_qr_failed"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const items: EventItem[] = [];

  for (const row of webhookEvents) {
    let source: EventItem["source"] = "unknown";
    let amountPaise: number | undefined;
    let providerRef: string | undefined;
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      if (payload.source === "webhook") source = "webhook";
      else if (payload.source === "poll") source = "poll";
      else if (payload.source === "demo") source = "demo";
      if (typeof payload.amountPaise === "number") amountPaise = payload.amountPaise;
      if (typeof payload.providerRef === "string") providerRef = payload.providerRef;
    } catch {
      // keep defaults
    }
    if (providerRef?.startsWith("pay_synthtest")) source = "synthetic";
    items.push({
      id: row.id,
      kind: row.kind,
      at: row.receivedAt.toISOString(),
      source,
      orderId: row.orderId ?? undefined,
      amountPaise,
      providerRef: providerRef?.startsWith("demo-") ? undefined : providerRef,
      handled: row.handled,
      reason: row.reason ?? undefined,
    });
  }

  for (const row of provisioning) {
    items.push({
      id: row.id,
      kind: row.action,
      at: row.createdAt.toISOString(),
      source: "system",
      orderId: row.orderId ?? undefined,
      reason: row.detail ?? undefined,
    });
  }

  items.sort((a, b) => b.at.localeCompare(a.at));

  return NextResponse.json(
    { mode, items: items.slice(0, 40) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
