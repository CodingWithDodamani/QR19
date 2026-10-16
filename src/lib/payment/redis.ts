/**
 * Lazy Redis access gated behind `REDIS_URL`.
 *
 * Two named connections are maintained on purpose:
 * - `"bus"`      — SSE event bus. Calling `subscribe()` puts a node-redis
 *                  client into subscriber mode, after which only pub/sub
 *                  commands are allowed on that connection.
 * - `"commands"` — rate limiter `EVAL` of the fixed-window script; it must
 *                  run on a non-subscriber connection.
 *
 * When `REDIS_URL` is unset — local dev and single-instance deploys —
 * `getRedis()` resolves `undefined` and callers fall back to their in-memory
 * paths (the behavior this app always had).
 *
 * A failed initial connect is remembered for a cooldown (`RETRY_MS`) so a
 * down Redis is not hammered on every request; after a successful connect,
 * node-redis handles reconnects on its own.
 */
import { createClient } from "redis";

export type RedisPurpose = "bus" | "commands";

/** Minimal slice of the node-redis client this module uses. Declared locally
 * on purpose: node-redis's generic-heavy `RedisClientType` defaults do not
 * unify with the narrower generics `createClient({ url })` infers, and
 * callers only ever touch these methods. */
export interface RedisClient {
  on(event: "error", listener: (...args: unknown[]) => void): unknown;
  connect(): Promise<unknown>;
  subscribe(channel: string, listener: (message: string, channel: string) => void): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

const RETRY_MS = 30_000;

const globalForRedis = globalThis as unknown as {
  __paymentRedisClients: Map<RedisPurpose, Promise<RedisClient | undefined>> | undefined;
  __paymentRedisRetryAt: Map<RedisPurpose, number> | undefined;
};

function clients(): Map<RedisPurpose, Promise<RedisClient | undefined>> {
  if (!globalForRedis.__paymentRedisClients) {
    globalForRedis.__paymentRedisClients = new Map();
  }
  return globalForRedis.__paymentRedisClients;
}

function cooldowns(): Map<RedisPurpose, number> {
  if (!globalForRedis.__paymentRedisRetryAt) {
    globalForRedis.__paymentRedisRetryAt = new Map();
  }
  return globalForRedis.__paymentRedisRetryAt;
}

export function getRedis(purpose: RedisPurpose): Promise<RedisClient | undefined> {
  if (!process.env.REDIS_URL) return Promise.resolve(undefined);

  const cooldownUntil = cooldowns().get(purpose);
  if (cooldownUntil && Date.now() < cooldownUntil) return Promise.resolve(undefined);

  const existing = clients().get(purpose);
  if (existing) return existing;

  const attempt = (async (): Promise<RedisClient | undefined> => {
    try {
      const client = createClient({ url: process.env.REDIS_URL }) as unknown as RedisClient;
      // A listener must exist so socket errors are never unhandled 'error'
      // events; node-redis retries reconnects on its own after that.
      client.on("error", () => {});
      await client.connect();
      return client;
    } catch {
      // Cooldown: don't hammer a down Redis on every request. Runs in a later
      // microtask than the `clients().set` below, so no set/delete race.
      cooldowns().set(purpose, Date.now() + RETRY_MS);
      clients().delete(purpose);
      return undefined;
    }
  })();

  clients().set(purpose, attempt);
  return attempt;
}
