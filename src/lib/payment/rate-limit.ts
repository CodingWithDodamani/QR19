/**
 * Fixed-window rate limiter (per IP, per bucket).
 *
 * - `REDIS_URL` set: counters live in Redis (atomic INCR + PEXPIRE via a Lua
 *   script), so limits are shared across horizontally scaled instances.
 * - `REDIS_URL` unset — local dev / single instance — or Redis unreachable:
 *   falls back to the original in-memory limiter (per-instance limits), the
 *   behavior this app has always had.
 *
 * Limits are intentionally generous so normal staff flows never hit them.
 */

import { getRedis } from "./redis";

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
  /* WhatsApp alerting: operator-triggered test send (POST) + config status
   * (GET). Tight — a live test sends real Meta messages that cost money. */
  whatsappTest: { limit: 5, windowMs: 60_000 },
  /* WhatsApp recipients added from the console (GET list / POST add /
   * DELETE one). Reads refresh alongside status; mutations are ADMIN-gated. */
  whatsappRecipients: { limit: 30, windowMs: 60_000 },
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

export async function rateLimit(
  request: Request,
  bucket: keyof typeof RATE_LIMITS
): Promise<RateLimitResult> {
  return applyDistributed(clientKey(request, bucket), RATE_LIMITS[bucket]);
}

/**
 * Same limiter with an explicit key — used for per-session limits on the
 * recipient-lookup endpoints (an IP can carry several sessions; a session is
 * the stronger anti-enumeration key).
 */
export async function rateLimitKeyed(
  bucket: keyof typeof RATE_LIMITS,
  key: string
): Promise<RateLimitResult> {
  return applyDistributed(`${bucket}:${key}`, RATE_LIMITS[bucket]);
}

/** Atomic fixed-window: INCR now, PEXPIRE on first hit — plus a heal for a
 * key that somehow lost its TTL. Returns `{count, ttlMs}`. */
const FIXED_WINDOW_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/**
 * Redis-backed window when `REDIS_URL` is set, in-memory otherwise. Any
 * Redis problem (unreachable, malformed reply) degrades to the in-memory
 * limiter so endpoints never fail open.
 */
async function applyDistributed(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const redis = await getRedis("commands");
  if (!redis) return applyLimit(key, rule);
  try {
    const reply = await redis.eval(FIXED_WINDOW_LUA, {
      keys: [`qr19:rl:${key}`],
      arguments: [String(rule.windowMs)],
    });
    const parts = Array.isArray(reply) ? reply.map(Number) : [];
    const count = parts[0];
    const ttlMs = parts[1];
    if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
      return applyLimit(key, rule);
    }
    if (count > rule.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSecs: Math.max(1, Math.ceil(ttlMs / 1000)),
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSecs: 0,
    };
  } catch {
    // Redis down — degrade to the in-memory limiter (per-instance limits)
    // rather than failing open or erroring the request.
    return applyLimit(key, rule);
  }
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
