import { randomUUID } from "crypto";

import { db } from "@/lib/db";
import { buildUpiLink } from "@/lib/upi";

import { MAX_ORDERS_PER_QUEUE, MAX_PAISE_PER_ORDER, MAX_TOTAL_PAISE, clampExpirySecs } from "./config";
import { recordFraudAlert } from "./fraud";
import { publish } from "./event-bus";
import {
  paytmCheckStatus,
  paytmCreateDynamicQr,
  PaytmApiError,
} from "./paytm";
import { getPspCredentials, resolvePaymentMode } from "./psp-settings";
import { phonepeCheckStatus, phonepeInitiatePay, PhonePeApiError } from "./phonepe";
import { RZP_MAX_QR_TTL_SECS, RazorpayApiError, razorpayCreateQr, razorpayFetchQrPayments } from "./razorpay";
import type {
  Notice,
  OrderDTO,
  OrderStatus,
  PaymentMode,
  ProcessResult,
  ProviderEvent,
  QueueState,
  QueueStatus,
} from "./types";

/**
 * Core queue service — the single place where order/queue status changes.
 *
 * Invariants enforced here:
 * - Only verified provider events (live webhook or DEMO simulation, which
 *   flows through this same function) can mark an order `paid`.
 * - Event processing is idempotent (unique WebhookEvent id).
 * - Wrong/partial amounts never advance the queue.
 * - ONE provider transaction reference verifies exactly ONE order — reused
 *   references (the "one screenshot shown five times" scam) are blocked
 *   and raised as fraud alerts.
 * - Out-of-order successes are recorded and audited, never silently dropped.
 * - Expired orders can never remain visible/payable.
 * - Staff overrides (`skip`/`cancel`) are audited and never labeled paid.
 */

const PAYABLE_STATUSES: OrderStatus[] = ["pending", "displayed"];

/** Where a provider event came from. All of them flow through the same
 *  verified processor — the actor only feeds the audit/event ledgers. */
export type EventActor = "webhook" | "demo" | "poll" | "webhook-test";

export class ServiceError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "invalid"
      | "conflict"
      | "forbidden",
    message: string
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/**
 * Internal control-flow signal: carries a fully-processed fraud result
 * (event ledger updated, fraud alert raised, notice published) out of the
 * conditional-update P2002 catch and into processProviderEvent's main flow,
 * whose final `payment.success` handling then re-throws/returns it.
 */
class FraudPathSignal extends Error {
  constructor(public readonly result: ProcessResult) {
    super("duplicate_txn_ref (resolved via unique providerRef index)");
    this.name = "FraudPathSignal";
  }
}

/* ------------------------------------------------------------------ */
/* ID generation                                                       */
/* ------------------------------------------------------------------ */

const ORDER_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars

function randomToken(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ORDER_ALPHABET[byte % ORDER_ALPHABET.length];
  return out;
}

/** Unique, human-readable order reference embedded in the QR (`tr`) and
 *  expected in PSP webhook events. Alphanumeric only (UPI-safe). */
function generateOrderId(seq: number): string {
  return `ON99${randomToken(10)}${String(seq).padStart(2, "0")}`;
}

function newEventId(): string {
  return `evt-${randomUUID()}`;
}

/* ------------------------------------------------------------------ */
/* Audit + event records                                               */
/* ------------------------------------------------------------------ */

function audit(
  queueId: string,
  orderId: string | null,
  action: string,
  actor: EventActor | "staff" | "system",
  detail?: string
): Promise<unknown> {
  return db.auditLog.create({
    data: { queueId, orderId, action, actor, detail: detail ?? null },
  });
}

/** Persist the normalized event record (redacted whitelist payload). */
async function recordEvent(
  event: ProviderEvent,
  actor: EventActor,
  data: { queueId?: string; handled: boolean; reason: ProcessResult["reason"]; message?: string }
): Promise<"created" | "duplicate"> {
  const payload = JSON.stringify({
    source: actor,
    type: event.type,
    orderId: event.orderId,
    amountPaise: event.amountPaise ?? null,
    providerRef: event.providerRef ?? null,
    terminal: event.terminal ?? null,
    reason: event.reason ?? null,
  });
  try {
    await db.webhookEvent.create({
      data: {
        id: event.eventId,
        queueId: data.queueId ?? null,
        orderId: event.orderId,
        kind: event.type,
        handled: data.handled,
        reason: data.reason,
        payload,
      },
    });
    return "created";
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return "duplicate";
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Queue creation                                                      */
/* ------------------------------------------------------------------ */

export interface CreateQueueInput {
  upiId: string;
  payeeName: string;
  note?: string;
  amountsPaise: number[];
  /** Anti-scam mode: every amount must be different (≥ ₹1 apart). */
  uniqueAmounts?: boolean;
  expiresInSecs?: number;
  idempotencyKey: string;
}

export interface CreateQueueResult {
  created: boolean;
  queueId: string;
  state: QueueState;
}

const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,60}@[a-zA-Z0-9.-]{2,60}$/;

export async function createQueue(input: CreateQueueInput): Promise<CreateQueueResult> {
  const mode = await resolvePaymentMode();
  const upiId = input.upiId?.trim() ?? "";
  const payeeName = input.payeeName?.trim() ?? "";
  const note = (input.note ?? "").trim().slice(0, 80);
  const key = input.idempotencyKey?.trim() ?? "";

  if (!UPI_ID_RE.test(upiId)) {
    throw new ServiceError("invalid", "A valid UPI ID (name@bank) is required.");
  }
  if (!payeeName || payeeName.length > 100) {
    throw new ServiceError("invalid", "Payee name (1-100 chars) is required.");
  }
  if (key.length < 8 || key.length > 120) {
    throw new ServiceError("invalid", "A valid idempotency key is required.");
  }
  const amounts = input.amountsPaise;
  if (
    !Array.isArray(amounts) ||
    amounts.length < 1 ||
    amounts.length > MAX_ORDERS_PER_QUEUE ||
    !amounts.every((a) => Number.isSafeInteger(a) && a >= 1 && a <= MAX_PAISE_PER_ORDER)
  ) {
    throw new ServiceError(
      "invalid",
      `amountsPaise must be 1-${MAX_ORDERS_PER_QUEUE} integers of 1-${MAX_PAISE_PER_ORDER} paise each.`
    );
  }
  const totalPaise = amounts.reduce((sum, a) => sum + a, 0);
  if (totalPaise > MAX_TOTAL_PAISE) {
    throw new ServiceError("invalid", `Total exceeds ${MAX_TOTAL_PAISE} paise.`);
  }
  if (input.uniqueAmounts && new Set(amounts).size !== amounts.length) {
    throw new ServiceError(
      "invalid",
      "Unique-amount mode requires every QR amount to be different."
    );
  }

  // Idempotent create: same key returns the same queue instead of
  // double-generating the same orders (prevents accidental duplicates).
  const existing = await db.paymentQueue.findUnique({
    where: { idempotencyKey: key },
    include: { orders: { orderBy: { seq: "asc" } } },
  });
  if (existing) {
    return {
      created: false,
      queueId: existing.id,
      state: serializeState(mode, existing, existing.orders),
    };
  }

  const expiresInSecs = clampExpirySecs(input.expiresInSecs);
  const now = Date.now();

  try {
    const queue = await db.paymentQueue.create({
      data: {
        upiId,
        payeeName,
        note: note || null,
        totalPaise,
        totalCount: amounts.length,
        currentIndex: 0,
        status: "active",
        idempotencyKey: key,
        uniqueAmounts: input.uniqueAmounts === true,
        orders: {
          create: amounts.map((amountPaise, index) => {
            const orderId = generateOrderId(index + 1);
            return {
              seq: index + 1,
              orderId,
              amountPaise,
              status: "pending",
              qrPayload: buildUpiLink(upiId, payeeName, amountPaise, note, orderId),
              expiresAt: new Date(now + expiresInSecs * 1000),
            };
          }),
        },
      },
      include: { orders: { orderBy: { seq: "asc" } } },
    });

    await audit(queue.id, null, "queue_created", "staff", `${amounts.length} orders, ₹${(totalPaise / 100).toFixed(2)}, expiry ${expiresInSecs}s`);
    publish(queue.id, { type: "state", state: serializeState(mode, queue, queue.orders) });

    // PSP modes: provision the first order's real payment artifact right
    // away (fire-and-forget — it arrives via a state push a moment later).
    const firstOrder = queue.orders[0];
    if (mode !== "demo" && mode !== "live" && firstOrder) {
      void ensureProviderQr(firstOrder.orderId).catch(() => undefined);
    }

    return { created: true, queueId: queue.id, state: serializeState(mode, queue, queue.orders) };
  } catch (error) {
    // Lost a race against an identical idempotency key — return the winner.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const winner = await db.paymentQueue.findUnique({
        where: { idempotencyKey: key },
        include: { orders: { orderBy: { seq: "asc" } } },
      });
      if (winner) {
        return { created: false, queueId: winner.id, state: serializeState(mode, winner, winner.orders) };
      }
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Pointer + expiry maintenance                                        */
/* ------------------------------------------------------------------ */

/**
 * Recompute the queue pointer from the (authoritative) order statuses:
 * the current order is the first payable one in seq order. Also promotes
 * pending -> displayed for that order, and flips the queue to `completed`
 * when nothing remains payable.
 */
async function recomputeQueue(queueId: string): Promise<void> {
  const orders = await db.paymentOrder.findMany({
    where: { queueId },
    orderBy: { seq: "asc" },
    select: { id: true, seq: true, status: true, orderId: true },
  });

  const queue = await db.paymentQueue.findUnique({
    where: { id: queueId },
    select: { status: true, currentIndex: true },
  });
  if (!queue) return;

  const firstPayable = orders.find((o) => PAYABLE_STATUSES.includes(o.status as OrderStatus));
  const nextIndex = firstPayable ? firstPayable.seq - 1 : -1;

  let status: QueueStatus = queue.status === "cancelled" ? "cancelled" : "active";
  if (!firstPayable && status !== "cancelled") {
    status = "completed";
  }

  const changed = status !== queue.status || nextIndex !== queue.currentIndex;
  if (changed) {
    await db.paymentQueue.update({
      where: { id: queueId },
      data: { currentIndex: nextIndex, status },
    });
  }

  if (firstPayable && firstPayable.status === "pending") {
    await db.paymentOrder.update({
      where: { id: firstPayable.id },
      data: { status: "displayed" },
    });
  }

  // Provision the real PSP QR lazily for the current order (Razorpay
  // modes only — a no-op otherwise). Fire-and-forget: the QR lands via a
  // state push a moment later and must never block the write path.
  if (firstPayable && firstPayable.status !== "cancelled") {
    void ensureProviderQr(firstPayable.orderId).catch(() => undefined);
  }

  if (status === "completed" && queue.status !== "completed") {
    await audit(queueId, null, "queue_completed", "system");
  }
}

/** Expire stale payable orders. Returns the expired order ids. */
async function expireStaleOrders(
  queueId: string,
  actor: EventActor | "system"
): Promise<string[]> {
  const stale = await db.paymentOrder.findMany({
    where: {
      queueId,
      status: { in: PAYABLE_STATUSES },
      expiresAt: { lt: new Date() },
    },
    select: { id: true, orderId: true },
  });
  if (stale.length === 0) return [];

  await db.paymentOrder.updateMany({
    where: { id: { in: stale.map((o) => o.id) } },
    data: { status: "expired" },
  });
  for (const order of stale) {
    await audit(queueId, order.orderId, "order_expired", actor);
  }
  await recomputeQueue(queueId);
  return stale.map((o) => o.orderId);
}

/** Publish a transient notice to display devices. */
function notify(queueId: string, notice: Omit<Notice, "id">): void {
  publish(queueId, { type: "notice", notice: { ...notice, id: newEventId() } });
}

/* ------------------------------------------------------------------ */
/* Provider event processing (live webhook + DEMO share this path)      */
/* ------------------------------------------------------------------ */

export async function processProviderEvent(
  event: ProviderEvent,
  actor: EventActor
): Promise<ProcessResult> {
  // 1. Shape validation (never trust the wire).
  if (
    !event ||
    typeof event.eventId !== "string" ||
    event.eventId.length < 4 ||
    typeof event.type !== "string" ||
    typeof event.orderId !== "string" ||
    !event.orderId
  ) {
    return { handled: false, reason: "invalid", message: "Malformed event." };
  }
  if (
    event.amountPaise !== undefined &&
    (!Number.isSafeInteger(event.amountPaise) || event.amountPaise < 1)
  ) {
    return { handled: false, reason: "invalid", message: "amountPaise must be a positive integer." };
  }

  // 2. Idempotency — duplicate deliveries are acknowledged and ignored.
  const recorded = await recordEvent(event, actor, { handled: false, reason: "duplicate" });
  if (recorded === "duplicate") {
    return { handled: false, reason: "duplicate", message: "Event already processed." };
  }

  // 3. Locate the order.
  const order = await db.paymentOrder.findUnique({
    where: { orderId: event.orderId },
  });
  if (!order) {
    await db.webhookEvent.update({
      where: { id: event.eventId },
      data: { handled: false, reason: "unknown_order" },
    });
    if (event.type === "payment.success") {
      // A "success" for an order reference this app never issued: either a
      // stale QR from an old session was scanned, or someone is probing the
      // webhook. Real money may have moved — the merchant must reconcile it
      // in the PSP dashboard, so never drop this silently.
      await recordFraudAlert({
        type: "UNKNOWN_ORDER_PAYMENT",
        severity: "medium",
        message: `A payment success was reported for order reference “${event.orderId.slice(0, 40)}”, which does not exist in this app. If money actually arrived it belongs to no open QR — reconcile/refund it in your provider dashboard.`,
        orderId: event.orderId.slice(0, 60),
        details: { providerRef: event.providerRef ?? null, source: actor },
      });
    }
    return { handled: false, reason: "unknown_order", message: "No order with this ID." };
  }

  // Record the event's queue association.
  await db.webhookEvent.update({
    where: { id: event.eventId },
    data: { queueId: order.queueId },
  });

  // 4. Expiry takes precedence over anything the event says.
  const expiredNow = await expireStaleOrders(order.queueId, actor);
  const current = await db.paymentOrder.findUnique({ where: { id: order.id } });
  if (!current) {
    return { handled: false, reason: "unknown_order" };
  }

  /* ------------------------- payment.failed ------------------------- */
  if (event.type === "payment.failed") {
    if (!PAYABLE_STATUSES.includes(current.status as OrderStatus)) {
      await db.webhookEvent.update({ where: { id: event.eventId }, data: { handled: false, reason: "not_payable" } });
      return { handled: false, reason: "not_payable", message: "Order is no longer payable." };
    }

    if (event.terminal) {
      // PSP permanently closed this order (e.g. too many attempts).
      await db.paymentOrder.update({
        where: { id: current.id },
        data: { status: "failed", failureReason: event.reason ?? "provider_closed_order" },
      });
      await audit(current.queueId, current.orderId, "order_terminated", actor, event.reason);
      await recomputeQueue(current.queueId);
      notify(current.queueId, {
        kind: "order_terminated",
        message: `Order ${current.orderId} was closed by the provider (${event.reason ?? "terminal failure"}). Moving on.`,
        orderId: current.orderId,
      });
      await publishState(current.queueId);
      await db.webhookEvent.update({ where: { id: event.eventId }, data: { handled: true, reason: "ok" } });
      return { handled: true, reason: "ok" };
    }

    // Soft decline: the QR stays active — the customer can retry while the
    // provider still accepts this order. Show a non-blocking error only.
    await db.paymentOrder.update({
      where: { id: current.id },
      data: { failureReason: event.reason ?? "declined" },
    });
    await audit(current.queueId, current.orderId, "payment_declined", actor, event.reason);
    notify(current.queueId, {
      kind: "payment_declined",
      message: `Payment declined for ${current.orderId}${event.reason ? ` — ${event.reason}` : ""}. This QR stays active; the customer can retry.`,
      orderId: current.orderId,
    });
    await db.webhookEvent.update({ where: { id: event.eventId }, data: { handled: true, reason: "ok" } });
    return { handled: true, reason: "ok" };
  }

  /* ------------------------ order.terminated ------------------------ */
  if (event.type === "order.terminated") {
    if (!PAYABLE_STATUSES.includes(current.status as OrderStatus)) {
      await db.webhookEvent.update({ where: { id: event.eventId }, data: { handled: false, reason: "not_payable" } });
      return { handled: false, reason: "not_payable" };
    }
    await db.paymentOrder.update({
      where: { id: current.id },
      data: { status: "failed", failureReason: event.reason ?? "provider_closed_order" },
    });
    await audit(current.queueId, current.orderId, "order_terminated", actor, event.reason);
    await recomputeQueue(current.queueId);
    notify(current.queueId, {
      kind: "order_terminated",
      message: `Order ${current.orderId} was closed by the provider. Moving on.`,
      orderId: current.orderId,
    });
    await publishState(current.queueId);
    await db.webhookEvent.update({ where: { id: event.eventId }, data: { handled: true, reason: "ok" } });
    return { handled: true, reason: "ok" };
  }

  /* ------------------------- payment.success ------------------------ */
  if (event.type === "payment.success") {
    if (current.status === "paid") {
      // A repeat success for an already-paid order must never collect again.
      // When it is the SAME payment re-delivered (a webhook retry racing the
      // poll fallback), stay silent — otherwise audit + notify it loudly.
      const samePayment =
        Boolean(event.providerRef) && event.providerRef === current.providerRef;
      await db.webhookEvent.update({ where: { id: event.eventId }, data: { handled: false, reason: "already_paid" } });
      if (!samePayment) {
        await recordFraudAlert({
          type: "REPLAYED_SUCCESS",
          severity: "medium",
          message: `A second, different payment success was reported for order ${current.orderId}, which is already paid. Possible duplicate or edited payment proof — nothing was collected twice.`,
          queueId: current.queueId,
          orderId: current.orderId,
          details: { newRef: event.providerRef ?? null, paidWithRef: current.providerRef },
        });
        notify(current.queueId, {
          kind: "already_paid",
          message: `Ignored a repeat success for ${current.orderId} — already paid.`,
          orderId: current.orderId,
        });
      }
      return { handled: false, reason: "already_paid", message: "Order already paid — nothing to do." };
    }
    if (!PAYABLE_STATUSES.includes(current.status as OrderStatus)) {
      // Money arrived for a skipped/cancelled/expired/failed order. Record
      // the fact, audit it loudly, but never treat it as queue progress.
      await db.webhookEvent.update({ where: { id: event.eventId }, data: { handled: false, reason: "not_payable" } });
      await recordFraudAlert({
        type: "STALE_ORDER_PAYMENT",
        severity: "medium",
        message: `A payment was reported for order ${current.orderId}, but that QR was already ${current.status}. If the money really arrived it matches no open QR — verify in your provider dashboard and refund/reconcile manually.`,
        queueId: current.queueId,
        orderId: current.orderId,
        details: { orderStatus: current.status, providerRef: event.providerRef ?? null, amountPaise: event.amountPaise ?? null },
      });
      await audit(current.queueId, current.orderId, "success_for_non_payable_order", actor, `order status was ${current.status}`);
      notify(current.queueId, {
        kind: "out_of_order",
        message: `Payment received for ${current.orderId}, but that QR was ${current.status}. Recorded for reconciliation — no queue change.`,
        orderId: current.orderId,
      });
      return { handled: false, reason: "not_payable", message: `Order was ${current.status}; success recorded as audit only.` };
    }

    // Partial/wrong amount: do NOT mark paid, do NOT advance.
    if (
      event.amountPaise !== undefined &&
      event.amountPaise !== current.amountPaise
    ) {
      await db.webhookEvent.update({ where: { id: event.eventId }, data: { handled: false, reason: "amount_mismatch" } });
      await recordFraudAlert({
        type: "AMOUNT_MISMATCH",
        severity: "high",
        message: `Amount scam blocked on order ${current.orderId}: the QR asks for ₹${(current.amountPaise / 100).toFixed(2)} but a payment of ₹${(event.amountPaise / 100).toFixed(2)} was reported. The QR will NOT complete — do not hand over goods for this “proof”.`,
        queueId: current.queueId,
        orderId: current.orderId,
        details: { expectedPaise: current.amountPaise, receivedPaise: event.amountPaise, providerRef: event.providerRef ?? null },
      });
      await audit(
        current.queueId,
        current.orderId,
        "amount_mismatch",
        actor,
        `expected ${current.amountPaise}, got ${event.amountPaise}`
      );
      notify(current.queueId, {
        kind: "amount_mismatch",
        message: `Wrong amount for ${current.orderId}: expected ₹${(current.amountPaise / 100).toFixed(2)}, received ₹${(event.amountPaise / 100).toFixed(2)}. Not advancing.`,
        orderId: current.orderId,
      });
      return { handled: false, reason: "amount_mismatch", message: "Amount does not match the order — not advancing." };
    }

    // THE anti-replay guard: one provider transaction reference verifies
    // exactly ONE order, ever. If this reference already verified a
    // different order, someone is reusing one real payment as "proof" for
    // another QR — the classic one-screenshot-shown-five-times scam.
    // Block it, alarm it, and never advance. (Also enforced at the DB via a
    // unique index on providerRef; the caught-P2002 fallback below covers
    // the insert race that slips past this check.)
    if (event.providerRef) {
      const refOwner = await db.paymentOrder.findFirst({
        where: { providerRef: event.providerRef, id: { not: current.id } },
        select: { orderId: true, status: true },
      });
      if (refOwner) {
        return handleDuplicateTxnRef(event, current, refOwner);
      }
    }

    const wasCurrent = (await currentIndexSeq(current.queueId)) === current.seq;

    // Race-safe advance: the WHERE clause requires the order to still be
    // payable, so a concurrent winner (webhook + poll fallback) cannot
    // double-mark; losing the race lands in the already_paid path.
    // A FraudPathSignal is thrown when the unique providerRef index catches
    // the insert race (the check above already handles the plain case).
    let advance: Awaited<ReturnType<typeof db.paymentOrder.updateMany>>;
    try {
      advance = await db.paymentOrder
      .updateMany({
        where: {
          id: current.id,
          status: { in: PAYABLE_STATUSES },
        },
        data: {
          status: "paid",
          paidAt: new Date(),
          providerRef: event.providerRef ?? null,
          failureReason: null,
        },
      })
      .catch(async (error: unknown) => {
        // Unique providerRef lost to a concurrent winner: this reference
        // just verified a different order — the same reused-proof attack,
        // caught after the fact by the DB-level unique index.
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: string }).code === "P2002"
        ) {
          const winner = await db.paymentOrder.findFirst({
            where: { providerRef: event.providerRef },
            select: { orderId: true, status: true },
          });
          if (winner) {
            const fraudResult = await handleDuplicateTxnRef(event, current, winner);
            throw new FraudPathSignal(fraudResult);
          }
        }
        throw error;
      });
    } catch (error) {
      if (error instanceof FraudPathSignal) return error.result;
      throw error;
    }
    if (advance.count === 0) {
      // Another request already transitioned this order (paid/expired/...).
      await db.webhookEvent.update({ where: { id: event.eventId }, data: { handled: false, reason: "already_paid" } });
      return { handled: false, reason: "already_paid", message: "Order changed state concurrently — nothing to do." };
    }
    await audit(current.queueId, current.orderId, "payment_success", actor, `₹${(current.amountPaise / 100).toFixed(2)}${event.providerRef ? ` ref ${event.providerRef}` : ""}`);

    if (!wasCurrent) {
      // Out-of-order success: record it, audit it, but the visible queue
      // pointer only advances from its own current order — never silently
      // skipping unpaid QRs.
      await audit(current.queueId, current.orderId, "out_of_order_success", actor, "paid while another order was current");
      notify(current.queueId, {
        kind: "out_of_order",
        message: `Payment verified for ${current.orderId} (paid ahead of its turn). It will be skipped when the queue reaches it.`,
        orderId: current.orderId,
      });
    }

    await recomputeQueue(current.queueId);
    await publishState(current.queueId);
    await db.webhookEvent.update({ where: { id: event.eventId }, data: { handled: true, reason: "ok" } });
    return { handled: true, reason: "ok" };
  }

  // Unknown event types are acknowledged but ignored (logged for mapping fixes).
  await db.webhookEvent.update({ where: { id: event.eventId }, data: { handled: false, reason: "ignored_type" } });
  return { handled: false, reason: "ignored_type", message: `Unsupported event type "${event.type}".` };
}

/**
 * Shared fraud path for a provider transaction reference that was offered
 * for a SECOND order. Extracted so both the pre-check and the DB-level
 * P2002 fallback (unique providerRef index insert race) report identically.
 */
async function handleDuplicateTxnRef(
  event: ProviderEvent,
  current: { id: string; queueId: string; orderId: string },
  refOwner: { orderId: string; status: string }
): Promise<ProcessResult> {
  if (!event.providerRef) {
    throw new Error("handleDuplicateTxnRef requires event.providerRef");
  }
  const providerRef = event.providerRef;
  await db.webhookEvent.update({
    where: { id: event.eventId },
    data: { handled: false, reason: "duplicate_txn_ref" },
  });
  await recordFraudAlert({
    type: "DUPLICATE_TXN_REF",
    severity: "high",
    message: `Reused payment proof blocked: provider transaction ${providerRef} already verified order ${refOwner.orderId} (${refOwner.status}) — it was then presented again for order ${current.orderId}. One payment can complete exactly one QR; this one was NOT counted.`,
    queueId: current.queueId,
    orderId: current.orderId,
    details: { providerRef, firstSeenOrderId: refOwner.orderId },
  });
  await audit(current.queueId, current.orderId, "duplicate_txn_ref_blocked", "system", `ref ${providerRef} already used on ${refOwner.orderId}`);
  notify(current.queueId, {
    kind: "already_paid",
    message: `Blocked a reused payment proof for ${current.orderId} — that transaction already paid order ${refOwner.orderId}.`,
    orderId: current.orderId,
  });
  return {
    handled: false,
    reason: "duplicate_txn_ref",
    message: "This provider transaction reference was already used to verify another order.",
  };
}

async function currentIndexSeq(queueId: string): Promise<number | null> {
  const orders = await db.paymentOrder.findMany({
    where: { queueId },
    orderBy: { seq: "asc" },
    select: { seq: true, status: true },
  });
  const first = orders.find((o) => PAYABLE_STATUSES.includes(o.status as OrderStatus));
  return first ? first.seq : null;
}

/** Reap stale orders + broadcast a fresh snapshot. */
export async function publishState(queueId: string): Promise<void> {
  const state = await getQueueState(queueId);
  if (state) publish(queueId, { type: "state", state });
}

/* ------------------------------------------------------------------ */
/* PSP payment provisioning (Razorpay / PhonePe / Paytm modes)          */
/* ------------------------------------------------------------------ */

const QR_PROVISION_BACKOFF_MS = 45_000;

/** In-flight guard: several concurrent state recomputes can try to
 *  provision the same order's payment artifact at once (webhook + SSE
 *  heartbeat + state read). They must collapse into ONE PSP API call —
 *  the backoff alone cannot help because no error is written yet. */
const qrProvisionInFlight = new Map<string, Promise<void>>();

/**
 * Lazily provision the REAL PSP payment artifact for an order
 * (PSP modes only; a no-op in demo/legacy-live).
 *
 * One artifact per displayed order, created on demand — one API call per
 * displayed order instead of the whole queue up front (faster start, and
 * nothing is ever provisioned for orders that may never be shown).
 *
 * Provider dispatch (exactly ONE branch runs per active mode):
 * - razorpay → single-use fixed-amount UPI QR (providerQrId + image).
 * - paytm    → Dynamic QR API (qrData stored as the order's qrPayload).
 * - phonepe  → Pay API PAY_PAGE (paymentPageUrl; NO QR is fabricated —
 *              PhonePe does not return a scannable QR string).
 *
 * Failures are stored on the order (providerQrError) and surfaced honestly
 * — the display shows the error instead of pretending an artifact exists.
 */
export async function ensureProviderQr(orderId: string): Promise<void> {
  const inFlight = qrProvisionInFlight.get(orderId);
  if (inFlight) return inFlight;
  const promise = ensureProviderQrInner(orderId).finally(() => {
    qrProvisionInFlight.delete(orderId);
  });
  qrProvisionInFlight.set(orderId, promise);
  return promise;
}

/** Best-effort public origin for PhonePe redirect/callback URLs. Callbacks
 *  only reach the app when APP_ORIGIN is a publicly reachable URL; the
 *  status-API polling fallback works regardless. */
function providerOrigin(): string {
  const raw = process.env.APP_ORIGIN?.trim().replace(/\/$/, "");
  return raw && /^https?:\/\//.test(raw) ? raw : "http://localhost:3000";
}

/** Human message from a provider error (honest, no invention). */
function providerErrorMessage(error: unknown): string {
  if (error instanceof RazorpayApiError) {
    return `${error.message}${error.hint ? ` — ${error.hint}` : ""}`;
  }
  if (error instanceof PhonePeApiError) {
    return `${error.message}${error.hint ? ` — ${error.hint}` : ""}`;
  }
  if (error instanceof PaytmApiError) {
    return `${error.message}${error.hint ? ` — ${error.hint}` : ""}`;
  }
  return "Could not reach the payment provider.";
}

async function ensureProviderQrInner(orderId: string): Promise<void> {
  const mode = await resolvePaymentMode();
  if (mode === "demo" || mode === "live") return;

  const order = await db.paymentOrder.findUnique({ where: { orderId } });
  if (!order || !PAYABLE_STATUSES.includes(order.status as OrderStatus)) return;

  // Already provisioned markers per provider:
  // - razorpay: providerQrId set at creation.
  // - paytm:    providerQrCreatedAt marks the dynamic-QR handoff.
  // - phonepe:  paymentPageUrl marks the PAY_PAGE handoff (no QR exists).
  const alreadyProvisioned =
    Boolean(order.providerQrId) ||
    (mode.startsWith("paytm-") && Boolean(order.providerQrCreatedAt)) ||
    (mode.startsWith("phonepe-") && Boolean(order.paymentPageUrl));
  if (alreadyProvisioned) return;
  // Backoff: a recent provisioning failure should not be retried on every
  // heartbeat — let the merchant actually read the error first.
  if (
    order.providerQrError &&
    Date.now() - order.updatedAt.getTime() < QR_PROVISION_BACKOFF_MS
  ) {
    return;
  }

  const creds = await getPspCredentials();
  if (!creds) return;

  const queue = await db.paymentQueue.findUnique({ where: { id: order.queueId } });
  if (!queue) return;

  try {
    if (mode === "razorpay-test" || mode === "razorpay-live") {
      const nowSecs = Math.floor(Date.now() / 1000);
      // Razorpay caps single-use QRs at 2 hours and wants close_by at least
      // ~2 minutes ahead — clamp from both sides (documented behavior).
      const closeByUnix = Math.min(
        Math.max(nowSecs + 150, Math.floor(order.expiresAt.getTime() / 1000)),
        nowSecs + RZP_MAX_QR_TTL_SECS
      );
      const qr = await razorpayCreateQr(creds, {
        amountPaise: order.amountPaise,
        name: queue.payeeName,
        description: queue.note ?? `Order ${order.orderId}`,
        notes: { queueId: order.queueId, orderId: order.orderId, app: "QR19" },
        closeByUnix,
      });
      await db.paymentOrder.update({
        where: { id: order.id },
        data: {
          providerQrId: qr.id,
          providerQrImageUrl: qr.image_url ?? null,
          providerQrError: null,
          providerQrCreatedAt: new Date(),
        },
      });
      await audit(order.queueId, order.orderId, "provider_qr_created", "system", `razorpay ${qr.id}`);
    } else if (mode === "paytm-test" || mode === "paytm-live") {
      // Validity clamped to [60, 21600]s by the client (documented bounds).
      const validitySecs = Math.floor((order.expiresAt.getTime() - Date.now()) / 1000);
      const qr = await paytmCreateDynamicQr(creds, {
        orderId: order.orderId,
        amountPaise: order.amountPaise,
        validitySecs,
      });
      await db.paymentOrder.update({
        where: { id: order.id },
        data: {
          // Paytm's dynamic QR pays into the merchant's Paytm account and
          // can be verified through the status API — safe to render.
          qrPayload: qr.qrData,
          providerQrId: qr.qrImageId,
          providerQrError: null,
          providerQrCreatedAt: new Date(),
        },
      });
      await audit(order.queueId, order.orderId, "provider_qr_created", "system", `paytm${qr.qrImageId ? ` ${qr.qrImageId}` : ""}`);
    } else {
      // phonepe-test / phonepe-live: PAY_PAGE. PhonePe does NOT return a
      // scannable UPI QR string for this flow, so none is stored or shown.
      const page = await phonepeInitiatePay(creds, {
        merchantTransactionId: order.orderId,
        amountPaise: order.amountPaise,
        redirectUrl: `${providerOrigin()}/`,
        callbackUrl: `${providerOrigin()}/api/webhooks/phonepe`,
      });
      await db.paymentOrder.update({
        where: { id: order.id },
        data: {
          paymentPageUrl: page.redirectUrl,
          providerQrError: null,
          providerQrCreatedAt: new Date(),
        },
      });
      await audit(order.queueId, order.orderId, "provider_payment_page_created", "system", "phonepe PAY_PAGE");
    }
    await publishState(order.queueId);
  } catch (error) {
    const message = providerErrorMessage(error);
    await db.paymentOrder.update({
      where: { id: order.id },
      data: { providerQrError: message.slice(0, 300) },
    });
    await audit(order.queueId, order.orderId, "provider_qr_failed", "system", message.slice(0, 300));
    await publishState(order.queueId);
  }
}

/* ------------------------------------------------------------------ */
/* Webhook-less verification fallback (PSP modes)                      */
/* ------------------------------------------------------------------ */

/**
 * Poll the payment provider for the current order and feed any confirmed
 * payment through the same verified processor.
 *
 * This runs from the SSE heartbeat so a queue advances even when the PSP
 * cannot reach this deployment with webhooks (local sandboxes, private
 * networks). Webhooks/callbacks remain the primary channel; this is a
 * safety net — each provider's own documented status API is the
 * verification source:
 * - razorpay → GET /payments/qr_codes/:id/payments (captured only)
 * - phonepe  → Check Payment Status API (data.state COMPLETED/FAILED)
 * - paytm    → Transaction Status API v3 (TXN_SUCCESS/TXN_FAILURE)
 *
 * Deterministic event ids (`rzp-poll-…`, `phonepe-poll-…`, `paytm-poll-…`)
 * make repeats idempotent across heartbeats AND against webhook deliveries
 * of the same payment (a true double-delivery collapses into the silent
 * already-paid path because both carry the same providerRef).
 *
 * Exactly ONE provider branch runs per active mode — the others no-op.
 */
export async function pollCurrentOrderPayments(queueId: string): Promise<void> {
  const mode = await resolvePaymentMode();
  if (mode === "demo" || mode === "live") return;
  const creds = await getPspCredentials();
  if (!creds) return;

  // The current payable order (first in seq order).
  const payable = await db.paymentOrder.findMany({
    where: { queueId, status: { in: PAYABLE_STATUSES } },
    orderBy: { seq: "asc" },
    take: 1,
  });
  const order = payable[0];
  if (!order) return;

  if (mode === "razorpay-test" || mode === "razorpay-live") {
    if (!order.providerQrId) return;
    let payments;
    try {
      payments = await razorpayFetchQrPayments(creds, order.providerQrId);
    } catch {
      return; // best-effort; the next heartbeat retries
    }
    for (const payment of payments) {
      if (payment.status !== "captured") continue;
      await processProviderEvent(
        {
          eventId: `rzp-poll-${payment.id}-${order.orderId}`,
          type: "payment.success",
          orderId: order.orderId,
          amountPaise: payment.amount,
          providerRef: payment.id,
        },
        "poll"
      ).catch(() => undefined);
    }
    return;
  }

  if (mode === "phonepe-test" || mode === "phonepe-live") {
    // Only orders we actually initiated (paymentPageUrl present) exist on
    // PhonePe's side — our orderId is their merchantTransactionId.
    if (!order.paymentPageUrl) return;
    let status: Awaited<ReturnType<typeof phonepeCheckStatus>>;
    try {
      status = await phonepeCheckStatus(creds, order.orderId);
    } catch {
      return; // best-effort; the next heartbeat retries
    }
    if (status.kind === "pending") return;
    await processProviderEvent(
      status.kind === "success"
        ? {
            eventId: `phonepe-poll-${status.transactionId ?? status.state}-${order.orderId}`,
            type: "payment.success",
            orderId: order.orderId,
            amountPaise: status.amountPaise,
            providerRef: status.transactionId,
          }
        : {
            eventId: `phonepe-poll-${status.transactionId ?? status.state}-${order.orderId}`,
            type: "payment.failed",
            orderId: order.orderId,
            providerRef: status.transactionId,
            terminal: true,
            reason: status.message ?? "phonepe_status_failed",
          },
      "poll"
    ).catch(() => undefined);
    return;
  }

  // paytm-test / paytm-live
  if (!order.providerQrCreatedAt) return; // dynamic QR not provisioned yet
  let status: Awaited<ReturnType<typeof paytmCheckStatus>>;
  try {
    status = await paytmCheckStatus(creds, order.orderId);
  } catch {
    return; // best-effort; the next heartbeat retries
  }
  if (status.kind === "pending") return;
  await processProviderEvent(
    status.kind === "success"
      ? {
          eventId: `paytm-poll-${status.txnId ?? "TXN_SUCCESS"}-${order.orderId}`,
          type: "payment.success",
          orderId: order.orderId,
          amountPaise: status.amountPaise,
          providerRef: status.txnId,
        }
      : {
          eventId: `paytm-poll-${status.txnId ?? "TXN_FAILURE"}-${order.orderId}`,
          type: "payment.failed",
          orderId: order.orderId,
          providerRef: status.txnId,
          terminal: true,
          reason: status.message ?? "paytm_txn_failure",
        },
    "poll"
  ).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/* Staff overrides (audited; never labeled paid)                       */
/* ------------------------------------------------------------------ */

export async function overrideOrder(
  queueId: string,
  orderId: string,
  action: "skip" | "cancel",
  reason?: string,
  actor: "staff" = "staff"
): Promise<QueueState> {
  const order = await db.paymentOrder.findFirst({
    where: { queueId, orderId },
  });
  if (!order) throw new ServiceError("not_found", "Order not found in this queue.");

  if (!PAYABLE_STATUSES.includes(order.status as OrderStatus)) {
    throw new ServiceError("conflict", `Order is already ${order.status}.`);
  }

  const detail = reason?.trim() ? reason.trim().slice(0, 200) : undefined;
  await db.paymentOrder.update({
    where: { id: order.id },
    data: { status: action === "skip" ? "skipped" : "cancelled" },
  });
  await audit(
    queueId,
    orderId,
    action === "skip" ? "order_skipped_by_staff" : "order_cancelled_by_staff",
    actor,
    detail ? `reason: ${detail}` : "no reason given"
  );

  await recomputeQueue(queueId);
  const state = await getQueueState(queueId);
  if (state) publish(queueId, { type: "state", state });
  return state as QueueState;
}

export async function cancelQueue(queueId: string, reason?: string): Promise<QueueState> {
  const queue = await db.paymentQueue.findUnique({ where: { id: queueId } });
  if (!queue) throw new ServiceError("not_found", "Queue not found.");
  if (queue.status === "cancelled") {
    return (await getQueueState(queueId)) as QueueState;
  }

  await db.paymentOrder.updateMany({
    where: { queueId, status: { in: PAYABLE_STATUSES } },
    data: { status: "cancelled" },
  });
  await db.paymentQueue.update({
    where: { id: queueId },
    data: { status: "cancelled", currentIndex: -1 },
  });
  const detail = reason?.trim() ? reason.trim().slice(0, 200) : undefined;
  await audit(queueId, null, "queue_cancelled_by_staff", "staff", detail ? `reason: ${detail}` : "no reason given");

  const state = await getQueueState(queueId);
  if (state) publish(queueId, { type: "state", state });
  return state as QueueState;
}

/* ------------------------------------------------------------------ */
/* Read model                                                          */
/* ------------------------------------------------------------------ */

/** Get the authoritative snapshot. Also runs expiry maintenance and the
 *  pending -> displayed promotion via recomputeQueue. */
export async function getQueueState(queueId: string): Promise<QueueState | null> {
  const queue = await db.paymentQueue.findUnique({
    where: { id: queueId },
    include: { orders: { orderBy: { seq: "asc" } } },
  });
  if (!queue) return null;

  await expireStaleOrders(queueId, "system");

  const fresh = await db.paymentQueue.findUnique({
    where: { id: queueId },
    include: { orders: { orderBy: { seq: "asc" } } },
  });
  if (!fresh) return null;

  await recomputeQueue(queueId);

  const finalQueue = await db.paymentQueue.findUnique({
    where: { id: queueId },
    include: { orders: { orderBy: { seq: "asc" } } },
  });
  if (!finalQueue) return null;

  return serializeState(await resolvePaymentMode(), finalQueue, finalQueue.orders);
}

function serializeState(
  mode: PaymentMode,
  queue: {
    id: string;
    status: string;
    upiId: string;
    payeeName: string;
    note: string | null;
    totalPaise: number;
    totalCount: number;
    uniqueAmounts: boolean;
    createdAt: Date;
  },
  orders: Array<{
    seq: number;
    orderId: string;
    amountPaise: number;
    status: string;
    qrPayload: string;
    createdAt: Date;
    expiresAt: Date;
    paidAt: Date | null;
    providerRef: string | null;
    failureReason: string | null;
    providerQrId: string | null;
    providerQrImageUrl: string | null;
    providerQrError: string | null;
    providerQrCreatedAt: Date | null;
    paymentPageUrl: string | null;
  }>
): QueueState {
  const orderDtos: OrderDTO[] = orders.map((o) => ({
    seq: o.seq,
    orderId: o.orderId,
    amountPaise: o.amountPaise,
    status: o.status as OrderStatus,
    qrPayload: o.qrPayload,
    createdAt: o.createdAt.toISOString(),
    expiresAt: o.expiresAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    providerRef: o.providerRef ?? undefined,
    failureReason: o.failureReason ?? undefined,
    providerQrId: o.providerQrId ?? undefined,
    providerQrImageUrl: o.providerQrImageUrl ?? undefined,
    providerQrCreatedAt: o.providerQrCreatedAt?.toISOString() ?? undefined,
    paymentPageUrl: o.paymentPageUrl ?? undefined,
    providerQrError: o.providerQrError ?? undefined,
  }));

  const firstPayable = orderDtos.find((o) => PAYABLE_STATUSES.includes(o.status));
  const collectedPaise = orderDtos
    .filter((o) => o.status === "paid")
    .reduce((sum, o) => sum + o.amountPaise, 0);
  const remainingPaise = orderDtos
    .filter((o) => PAYABLE_STATUSES.includes(o.status))
    .reduce((sum, o) => sum + o.amountPaise, 0);

  return {
    mode,
    serverTime: new Date().toISOString(),
    queue: {
      id: queue.id,
      status: queue.status as QueueStatus,
      upiId: queue.upiId,
      payeeName: queue.payeeName,
      note: queue.note,
      totalPaise: queue.totalPaise,
      totalCount: queue.totalCount,
      uniqueAmounts: queue.uniqueAmounts,
      currentSeq: firstPayable?.seq ?? null,
      createdAt: queue.createdAt.toISOString(),
    },
    orders: orderDtos,
    current: firstPayable ?? null,
    collectedPaise,
    remainingPaise,
    paidCount: orderDtos.filter((o) => o.status === "paid").length,
  };
}

/** DEMO mode simulation — builds a synthetic provider event and runs it
 *  through the exact same processor as a live webhook. Only callable when
 *  the app is in demo mode (enforced by the route). */
export async function simulateProviderEvent(input: {
  orderId: string;
  outcome:
    | "success"
    | "declined"
    | "terminate"
    | "wrong_amount"
    | "duplicate_success"
    | "replayed_proof";
  amountPaise?: number;
}): Promise<ProcessResult & { eventId: string }> {
  if ((await resolvePaymentMode()) !== "demo") {
    throw new ServiceError("forbidden", "Simulation is only available in demo mode.");
  }

  const base = {
    orderId: input.orderId,
    providerRef: `demo-${randomToken(8)}`,
  };

  let event: ProviderEvent;
  switch (input.outcome) {
    case "success":
      event = { ...base, eventId: newEventId(), type: "payment.success" };
      break;
    case "wrong_amount":
      // Deliberately off by ₹1 to exercise the amount-mismatch guard; the
      // exact value is filled in after the switch (needs the order row).
      event = { ...base, eventId: newEventId(), type: "payment.success" };
      break;
    case "declined":
      event = { ...base, eventId: newEventId(), type: "payment.failed", reason: "declined_by_customer" };
      break;
    case "terminate":
      event = { ...base, eventId: newEventId(), type: "order.terminated", reason: "closed_by_provider" };
      break;
    case "duplicate_success": {
      // Re-send the most recent handled success event from this queue
      // (any order) to prove duplicate deliveries are idempotent — e.g.
      // replaying order #1's success while order #2 is current must be
      // ignored with reason "already_paid", never collect again.
      const order = await db.paymentOrder.findUnique({ where: { orderId: input.orderId } });
      if (!order) throw new ServiceError("not_found", "Order not found.");
      const last = await db.webhookEvent.findFirst({
        where: { queueId: order.queueId, kind: "payment.success", handled: true },
        orderBy: { receivedAt: "desc" },
      });
      if (!last) {
        throw new ServiceError("conflict", "No previous success event to duplicate in this queue.");
      }
      event = { ...base, eventId: last.id, type: "payment.success" };
      break;
    }
    case "replayed_proof": {
      // The classic scam, replayed exactly: the customer shows the SAME
      // payment proof again for the NEXT QR. We take the most recent
      // verified payment's provider reference and present it as a fresh
      // success for the current order — the duplicate-reference guard must
      // block it and raise a high-severity fraud alert.
      const order = await db.paymentOrder.findUnique({ where: { orderId: input.orderId } });
      if (!order) throw new ServiceError("not_found", "Order not found.");
      const lastPaid = await db.paymentOrder.findFirst({
        where: {
          queueId: order.queueId,
          status: "paid",
          providerRef: { not: null },
          orderId: { not: order.orderId },
        },
        orderBy: { paidAt: "desc" },
        select: { providerRef: true, orderId: true },
      });
      if (!lastPaid?.providerRef) {
        throw new ServiceError(
          "conflict",
          "No earlier verified payment to replay — complete one payment first, then try the reused-proof attack."
        );
      }
      event = {
        orderId: input.orderId,
        eventId: newEventId(),
        type: "payment.success",
        amountPaise: order.amountPaise,
        providerRef: lastPaid.providerRef,
      };
      break;
    }
  }

  if (event.type === "payment.success" && input.outcome === "wrong_amount") {
    const order = await db.paymentOrder.findUnique({ where: { orderId: input.orderId } });
    if (!order) throw new ServiceError("not_found", "Order not found.");
    event.amountPaise = input.amountPaise ?? order.amountPaise + 100;
  }

  const result = await processProviderEvent(event, "demo");
  return { ...result, eventId: event.eventId };
}
