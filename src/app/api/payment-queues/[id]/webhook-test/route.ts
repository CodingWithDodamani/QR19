import { createHmac, randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { publicOrigin } from "@/lib/payment/psp-auth";
import { rateLimit } from "@/lib/payment/rate-limit";
import {
  getPspCredentials,
  resolvePaymentMode,
} from "@/lib/payment/psp-settings";

export const dynamic = "force-dynamic";

/**
 * POST /api/payment-queues/:id/webhook-test — RAZORPAY TEST MODE ONLY.
 *
 * Razorpay test-mode QR codes cannot be scanned by real UPI apps (their
 * documented FAQ), so before KYC the only way to exercise the FULL webhook
 * path is a signed delivery. This endpoint builds a payload shaped exactly
 * like Razorpay's documented `qr_code.credited` event for the current
 * order's REAL QR id, signs it with the configured webhook secret, and
 * POSTs it to this app's own /api/webhooks/razorpay — i.e. it goes through
 * genuine signature verification, deduplication and the verified
 * processor, not a shortcut.
 *
 * HONESTY RULES:
 * - Only available in razorpay-test mode. In razorpay-live (real money)
 *   it is hard-disabled (403) — no synthetic events can ever touch a live
 *   collection.
 * - The synthetic payment id is prefixed `pay_synthtest_` so it can never
 *   be confused with a real Razorpay payment in the ledger/monitor.
 * - The UI labels the button and its result as a signed synthetic event.
 */

function buildSignedPayload(order: {
  orderId: string;
  queueId: string;
  amountPaise: number;
  providerQrId: string | null;
  expiresAt: Date;
}, secret: string): { body: string; eventId: string } {
  const now = Math.floor(Date.now() / 1000);
  const paymentId = `pay_synthtest_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const body = {
    entity: "event",
    account_id: "acct_synthtest",
    event: "qr_code.credited",
    contains: ["payment", "qr_code"],
    payload: {
      payment: {
        entity: {
          id: paymentId,
          entity: "payment",
          amount: order.amountPaise,
          currency: "INR",
          status: "captured",
          method: "upi",
          captured: true,
          vpa: "synthetic@razorpaytest",
          notes: { queueId: order.queueId, orderId: order.orderId, app: "QR19" },
          created_at: now,
        },
      },
      qr_code: {
        entity: {
          id: order.providerQrId,
          entity: "qr_code",
          status: "closed",
          close_reason: "paid",
          payments_count_received: 1,
          notes: { queueId: order.queueId, orderId: order.orderId, app: "QR19" },
        },
      },
    },
    created_at: now,
  };
  const raw = JSON.stringify(body);
  const signature = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  return { body: raw, eventId: `evt-synthtest-${randomUUID()}` };
}

/** Candidate origins for the self-delivery, tried in order. */
function candidateOrigins(request: Request): string[] {
  const list: string[] = [];
  const envOrigin = process.env.APP_ORIGIN?.trim();
  if (envOrigin) list.push(envOrigin.replace(/\/$/, ""));
  const forwarded = publicOrigin(request);
  if (!list.includes(forwarded)) list.push(forwarded);
  const local = "http://127.0.0.1:3000";
  if (!list.includes(local)) list.push(local);
  return list;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const mode = await resolvePaymentMode();
  if (mode !== "razorpay-test") {
    return NextResponse.json(
      {
        error:
          mode === "razorpay-live"
            ? "Signed webhook tests are disabled in live mode — this collection verifies REAL payments only."
            : "Signed webhook tests are only available once Razorpay test keys are configured in the PSP console.",
      },
      { status: 403 }
    );
  }

  const limit = rateLimit(request, "webhookTest");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many webhook tests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  const creds = await getPspCredentials();
  if (!creds?.webhookSecret) {
    return NextResponse.json(
      {
        error:
          "Set the webhook secret in the PSP console first (the same secret you entered in the Razorpay dashboard) — the test delivery must pass real signature verification.",
      },
      { status: 409 }
    );
  }

  const { id } = await params;

  // The current payable order WITH an already-provisioned PSP QR.
  const payable = await db.paymentOrder.findMany({
    where: { queueId: id, status: { in: ["pending", "displayed"] }, providerQrId: { not: null } },
    orderBy: { seq: "asc" },
    take: 1,
  });
  const order = payable[0];
  if (!order?.providerQrId) {
    return NextResponse.json(
      {
        error:
          "The current order does not have a provisioned Razorpay QR yet — wait for the QR to appear, then retry.",
      },
      { status: 409 }
    );
  }

  const { body, eventId } = buildSignedPayload(
    {
      orderId: order.orderId,
      queueId: order.queueId,
      amountPaise: order.amountPaise,
      providerQrId: order.providerQrId,
      expiresAt: order.expiresAt,
    },
    creds.webhookSecret
  );

  let lastError = "Delivery failed.";
  for (const origin of candidateOrigins(request)) {
    try {
      const response = await fetch(`${origin}/api/webhooks/razorpay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Signature": createHmac("sha256", creds.webhookSecret)
            .update(body, "utf8")
            .digest("hex"),
          "x-razorpay-event-id": eventId,
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok) {
        await db.auditLog.create({
          data: {
            queueId: order.queueId,
            orderId: order.orderId,
            action: "webhook_test_sent",
            actor: "webhook-test",
            detail: `signed synthetic qr_code.credited delivered to the real webhook (${response.status})`,
          },
        });
        return NextResponse.json({
          delivered: true,
          status: response.status,
          result: data,
          eventId,
        });
      }
      lastError = `Webhook answered ${response.status}: ${JSON.stringify(data).slice(0, 200)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Delivery failed.";
    }
  }

  return NextResponse.json({ delivered: false, error: lastError }, { status: 502 });
}
