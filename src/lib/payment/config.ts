import type { PaymentMode } from "./types";

/**
 * Payment provider configuration.
 *
 * DEMO vs LIVE
 * ------------
 * - `PAYMENT_MODE=live` requires `PAYMENT_WEBHOOK_SECRET` (HMAC-SHA256 key
 *   shared with the PSP). Without it the app refuses to boot in live mode
 *   (fail closed) and falls back to clearly-labeled demo mode.
 * - Demo mode ships a simulation endpoint that generates synthetic provider
 *   events which run through the EXACT same idempotent processor as real
 *   webhooks. It is never presented as a real payment in the UI.
 */
export function getPaymentMode(): PaymentMode {
  const raw = (process.env.PAYMENT_MODE ?? "").trim().toLowerCase();
  const hasSecret = Boolean(process.env.PAYMENT_WEBHOOK_SECRET);

  if (raw === "live") {
    // Fail closed: no signing secret means webhooks could not be verified.
    return hasSecret ? "live" : "demo";
  }
  return "demo";
}

export function hasWebhookSecret(): boolean {
  return Boolean(process.env.PAYMENT_WEBHOOK_SECRET);
}

/** Per-order QR validity window (seconds). */
export const DEFAULT_EXPIRY_SECS = 900; // 15 minutes
export const MIN_EXPIRY_SECS = 60;
export const MAX_EXPIRY_SECS = 7200; // 2 hours

export function clampExpirySecs(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return DEFAULT_EXPIRY_SECS;
  return Math.min(MAX_EXPIRY_SECS, Math.max(MIN_EXPIRY_SECS, Math.round(n)));
}

/** Queue limits — mirror the on-device tool's conventions (₹1,999 per QR,
 *  ₹1,99,900 total across at most 100 QRs). */
export const MAX_PAISE_PER_ORDER = 199900;
export const MAX_TOTAL_PAISE = 19990000;
export const MAX_ORDERS_PER_QUEUE = 100;

/** Swipe direction for a paid QR leaving the screen. Kept as a named
 *  constant so it is a deliberate, consistent product choice ("paid =
 *  swipe left"). The client animation reads this from the status change,
 *  not from random direction state. */
export const PAID_SWIPE_DIRECTION = "left" as const;
