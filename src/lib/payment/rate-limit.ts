/**
 * Minimal fixed-window rate limiter (per IP, per bucket) kept in local
 * memory — consistent with this app's no-extra-middleware convention.
 *
 * Good enough for a single instance; if scaled out, move to Redis. Limits
 * are intentionally generous so normal staff flows never hit them.
 */

interface WindowState {
  count: number;
  resetAt: number;
}

const globalForLimiter = globalThis as unknown as {
  __paymentRateLimiter: Map<string, WindowState> | undefined;
};

function store(): Map<string, WindowState> {
  if (!globalForLimiter.__paymentRateLimiter) {
    globalForLimiter.__paymentRateLimiter = new Map();
  }
  return globalForLimiter.__paymentRateLimiter;
}

export interface RateLimitRule {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
}

/** Bucket rules for the payment queue endpoints. */
export const RATE_LIMITS = {
  queueCreate: { limit: 10, windowMs: 60_000 },
  queueState: { limit: 240, windowMs: 60_000 },
  override: { limit: 30, windowMs: 60_000 },
  simulate: { limit: 60, windowMs: 60_000 },
  webhook: { limit: 300, windowMs: 60_000 },
  /* Recipient discovery (mobile-number UPI lookup) — intentionally tight:
   * lookups expose personal data and must resist enumeration/harvesting. */
  lookup: { limit: 8, windowMs: 60_000 },
  lookupSession: { limit: 5, windowMs: 60_000 },
  lookupValidate: { limit: 20, windowMs: 60_000 },
  lookupSessionCreate: { limit: 12, windowMs: 300_000 },
  /* PSP console (merchant settings + monitors). Mutations are tight and
   * session-gated; the QR image proxy is public but throttled. */
  pspConfigure: { limit: 8, windowMs: 60_000 },
  pspTest: { limit: 6, windowMs: 60_000 },
  pspEvents: { limit: 60, windowMs: 60_000 },
  pspQrImage: { limit: 120, windowMs: 60_000 },
  pspFraudAlerts: { limit: 60, windowMs: 60_000 },
  webhookTest: { limit: 6, windowMs: 60_000 },
  /* Fraud Shield: the collection screen polls security state (alerts +
   * guarantees) and merchants can force a provider re-check of the current
   * QR ("customer claims paid, screen still pending"). */
  queueSecurity: { limit: 120, windowMs: 60_000 },
  verifyNow: { limit: 20, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSecs: number;
}

function clientKey(request: Request, bucket: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  return `${bucket}:${ip}`;
}

export function rateLimit(
  request: Request,
  bucket: keyof typeof RATE_LIMITS
): RateLimitResult {
  return applyLimit(clientKey(request, bucket), RATE_LIMITS[bucket]);
}

/**
 * Same limiter with an explicit key — used for per-session limits on the
 * recipient-lookup endpoints (an IP can carry several sessions; a session is
 * the stronger anti-enumeration key).
 */
export function rateLimitKeyed(
  bucket: keyof typeof RATE_LIMITS,
  key: string
): RateLimitResult {
  return applyLimit(`${bucket}:${key}`, RATE_LIMITS[bucket]);
}

function applyLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const map = store();

  // Opportunistic cleanup so the map cannot grow unbounded.
  if (map.size > 5_000) {
    for (const [k, v] of map) {
      if (v.resetAt <= now) map.delete(k);
    }
  }

  const existing = map.get(key);
  if (!existing || existing.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + rule.windowMs });
    return {
      allowed: true,
      remaining: rule.limit - 1,
      retryAfterSecs: 0,
    };
  }

  existing.count += 1;
  if (existing.count > rule.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSecs: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return {
    allowed: true,
    remaining: rule.limit - existing.count,
    retryAfterSecs: 0,
  };
}
