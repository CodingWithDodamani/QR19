import { createHash } from "crypto";

import { db } from "@/lib/db";

/**
 * Fraud Shield ledger — records tamper/scam signals raised by the payment
 * pipeline and serves them to the merchant (collection screen + PSP console).
 *
 * Threat model (the scams this app's merchants actually face in India):
 * - REUSED PAYMENT PROOF: the customer pays ONCE, then shows the same
 *   screenshot / SMS / "success" screen again for the next items. Blocked
 *   structurally (one provider transaction reference can verify exactly one
 *   order) and surfaced here as DUPLICATE_TXN_REF.
 * - UNDERPAYMENT: customer edits the amount in their UPI app (₹1999 → ₹20)
 *   and claims "paid". The server only ever completes a QR on an exact
 *   amount match; mismatches are surfaced as AMOUNT_MISMATCH.
 * - REPLAYED SUCCESS: a second, different "success" claim for an order that
 *   is already paid (REPLAYED_SUCCESS).
 * - STALE/FOREIGN PAYMENTS: money reported against expired/skipped orders
 *   or order references this app has never issued (STALE_ORDER_PAYMENT /
 *   UNKNOWN_ORDER_PAYMENT) — real money may have moved; the merchant must
 *   reconcile it manually in the PSP dashboard, and is told so.
 * - FORGED WEBHOOKS: deliveries failing signature verification
 *   (SIGNATURE_FAIL) — attackers probing the webhook endpoint.
 *
 * Rows are deduped by a stable fingerprint so a repeated attack increments
 * `count` + `lastSeenAt` instead of flooding the ledger. Recording is
 * best-effort and never breaks the payment path.
 */

export type FraudAlertType =
  | "DUPLICATE_TXN_REF"
  | "AMOUNT_MISMATCH"
  | "REPLAYED_SUCCESS"
  | "STALE_ORDER_PAYMENT"
  | "UNKNOWN_ORDER_PAYMENT"
  | "SIGNATURE_FAIL";

export type FraudSeverity = "low" | "medium" | "high";

export interface FraudAlertDTO {
  id: string;
  type: string;
  severity: FraudSeverity;
  message: string;
  count: number;
  queueId: string | null;
  orderId: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/** Human-readable label per alert type (used by the UI fallbacks). */
export const FRAUD_TYPE_LABEL: Record<FraudAlertType, string> = {
  DUPLICATE_TXN_REF: "Reused payment proof",
  AMOUNT_MISMATCH: "Wrong amount",
  REPLAYED_SUCCESS: "Replayed success",
  STALE_ORDER_PAYMENT: "Payment for a closed QR",
  UNKNOWN_ORDER_PAYMENT: "Unknown order reference",
  SIGNATURE_FAIL: "Forged webhook attempt",
};

export interface RecordFraudAlertInput {
  type: FraudAlertType;
  severity?: FraudSeverity;
  message: string;
  queueId?: string | null;
  orderId?: string | null;
  details?: Record<string, unknown>;
  /** Override the auto fingerprint (e.g. one bounded row per provider for
   *  signature failures). Must be stable across repeats. */
  dedupeKey?: string;
}

/**
 * Record (or increment) a fraud alert. Best-effort: a ledger failure must
 * never block or fail the payment pipeline itself.
 */
export async function recordFraudAlert(input: RecordFraudAlertInput): Promise<void> {
  const fingerprint =
    input.dedupeKey ??
    createHash("sha256")
      .update(
        [
          input.type,
          input.queueId ?? "",
          input.orderId ?? "",
          JSON.stringify(input.details ?? {}),
        ].join("|")
      )
      .digest("hex");

  const message = input.message.slice(0, 400);
  try {
    await db.fraudAlert.upsert({
      where: { fingerprint },
      create: {
        type: input.type,
        severity: input.severity ?? "medium",
        fingerprint,
        message,
        detailsJson: input.details ? JSON.stringify(input.details).slice(0, 1200) : null,
        queueId: input.queueId ?? null,
        orderId: input.orderId ?? null,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: new Date(),
        message,
        severity: input.severity ?? "medium",
      },
    });
  } catch (error) {
    console.error("[fraud] failed to record alert:", error);
  }
}

function toDto(row: {
  id: string;
  type: string;
  severity: string;
  message: string;
  count: number;
  queueId: string | null;
  orderId: string | null;
  createdAt: Date;
  lastSeenAt: Date;
}): FraudAlertDTO {
  return {
    id: row.id,
    type: row.type,
    severity: (row.severity as FraudSeverity) ?? "medium",
    message: row.message,
    count: row.count,
    queueId: row.queueId,
    orderId: row.orderId,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/** Recent alerts for the PSP console (operator-only endpoint). */
export async function listFraudAlerts(limit = 50): Promise<FraudAlertDTO[]> {
  const rows = await db.fraudAlert.findMany({
    orderBy: { lastSeenAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map(toDto);
}

/**
 * Recent alerts touching a queue (by queueId or by any of its orders).
 * Used by the public collection-screen security endpoint — messages are
 * written merchant-safe (no secrets, no personal data).
 */
export async function listQueueAlerts(queueId: string, limit = 8): Promise<FraudAlertDTO[]> {
  const rows = await db.fraudAlert.findMany({
    where: { queueId },
    orderBy: { lastSeenAt: "desc" },
    take: Math.min(Math.max(limit, 1), 20),
  });
  return rows.map(toDto);
}
