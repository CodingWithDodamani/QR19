/**
 * Shared types for the sequential payment queue feature.
 *
 * These DTOs cross the API boundary (REST + SSE), so they must stay
 * JSON-serializable. Amounts are integer paise, exactly like the on-device
 * tool (`src/lib/upi.ts`).
 */

export type PaymentMode =
  | "demo"
  /** Legacy env-configured generic PSP webhook (PAYMENT_WEBHOOK_SECRET). */
  | "live"
  /** Razorpay configured via the PSP console with rzp_test_ keys. */
  | "razorpay-test"
  /** Razorpay configured via the PSP console with rzp_live_ keys. */
  | "razorpay-live"
  /** PhonePe PG v1 with UAT (sandbox) credentials. */
  | "phonepe-test"
  /** PhonePe PG v1 with production credentials. */
  | "phonepe-live"
  /** Paytm Dynamic QR v3 with staging credentials. */
  | "paytm-test"
  /** Paytm Dynamic QR v3 with production credentials. */
  | "paytm-live";

/** Providers the PSP console can connect to. */
export type PspProvider = "razorpay" | "phonepe" | "paytm";

export type OrderStatus =
  | "pending"
  | "displayed"
  | "paid"
  | "expired"
  | "cancelled"
  | "failed"
  | "skipped";

export type QueueStatus = "active" | "completed" | "cancelled";

export interface OrderDTO {
  seq: number;
  orderId: string;
  amountPaise: number;
  status: OrderStatus;
  /** UPI deep link encoded in this order's QR image (demo/generic modes). */
  qrPayload: string;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  providerRef?: string;
  failureReason?: string;
  /** PSP QR provisioning (Razorpay modes): the real, PSP-generated QR. */
  providerQrId?: string;
  providerQrImageUrl?: string;
  /** When the PSP artifact (QR / payment page) was provisioned. Also the
   *  "provisioned" marker for Paytm dynamic QRs. */
  providerQrCreatedAt?: string;
  /**
   * PhonePe PAY_PAGE mode: the PhonePe-hosted payment page. PhonePe does
   * NOT return a scannable UPI QR string for this flow — the UI shows this
   * link (never a fabricated QR) and the server verifies through PhonePe's
   * Check Payment Status API.
   */
  paymentPageUrl?: string;
  /** Honest provisioning error — shown instead of pretending a QR exists. */
  providerQrError?: string;
}

export interface QueueDTO {
  id: string;
  status: QueueStatus;
  upiId: string;
  payeeName: string;
  note: string | null;
  totalPaise: number;
  totalCount: number;
  /** Anti-scam mode: every order's amount is different by ≥ ₹1. */
  uniqueAmounts: boolean;
  /** 1-based seq of the currently payable order, or null when none remains. */
  currentSeq: number | null;
  createdAt: string;
}

/**
 * Full server snapshot of a queue. This is the ONLY thing the display
 * device trusts — it never keeps local progress (resync = replace state).
 */
export interface QueueState {
  mode: PaymentMode;
  /** Emit time; clients use it to clock-skew the expiry countdown. */
  serverTime: string;
  queue: QueueDTO;
  /** All orders, seq-ascending. Upcoming QR payloads are included so the
   *  next QR is prefetched, but the UI must only ever display `current`. */
  orders: OrderDTO[];
  current: OrderDTO | null;
  collectedPaise: number;
  remainingPaise: number;
  paidCount: number;
}

/** A normalized provider payment event (webhook body or DEMO simulation). */
export interface ProviderEvent {
  /** Unique event id from the PSP — duplicate deliveries are ignored. */
  eventId: string;
  /** payment.success | payment.failed | order.terminated */
  type: string;
  /** Order reference the payment belongs to (our `orderId` / UPI `tr`). */
  orderId: string;
  /** Reported captured amount in paise — must match the order exactly. */
  amountPaise?: number;
  /** PSP transaction/payment reference (stored for reconciliation). */
  providerRef?: string;
  /** For payment.failed: true when the PSP closed the order for good. */
  terminal?: boolean;
  /** Human-readable decline reason (redact-free, optional). */
  reason?: string;
}

/** Result of running an event through the processor. */
export interface ProcessResult {
  handled: boolean;
  reason:
    | "ok"
    | "duplicate"
    | "unknown_order"
    | "amount_mismatch"
    | "not_payable"
    | "already_paid"
    | "duplicate_txn_ref"
    | "ignored_type"
    | "invalid";
  message?: string;
}

/** Over-the-wire shape of SSE messages. */
export type SseMessage =
  | { type: "state"; state: QueueState }
  | { type: "notice"; notice: Notice }
  | { type: "hello"; mode: PaymentMode };

/** Transient, non-blocking notice for the display screen. */
export interface Notice {
  id: string;
  kind: "payment_declined" | "amount_mismatch" | "order_expired" | "out_of_order" | "order_terminated" | "already_paid";
  message: string;
  orderId?: string;
}
