import { getRedis } from "./redis";
import type { SseMessage } from "./types";

/**
 * Pub/sub for queue state changes pushed to SSE display devices.
 *
 * - `REDIS_URL` unset (local dev / single instance): pure in-memory pub/sub,
 *   exactly the behavior this app has always had.
 * - `REDIS_URL` set: messages are also broadcast over Redis pub/sub so the
 *   bus works across multiple server instances. Each envelope carries this
 *   process's `origin` id so a publisher drops its own Redis echo (local
 *   subscribers were already served synchronously) — no double delivery.
 *
 * Redis is strictly best-effort: connection problems degrade to in-memory
 * delivery and never fail the state write that triggered the publish.
 *
 * The API surface (`subscribe` / `publish` / `subscriberCount`) is unchanged
 * from the in-memory-only version, so callers need no awareness of the mode.
 */

export type Subscriber = (message: SseMessage) => void;

interface LocalBus {
  channels: Map<string, Set<Subscriber>>;
}

interface Envelope {
  /** Instance id of the publishing process — used to drop own Redis echo. */
  origin: string;
  message: SseMessage;
}

const CHANNEL_PREFIX = "qr19:bus:";
const INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const globalForBus = globalThis as unknown as {
  __paymentLocalBus: LocalBus | undefined;
  __paymentRedisChannels: Set<string> | undefined;
};

function localBus(): LocalBus {
  if (!globalForBus.__paymentLocalBus) {
    globalForBus.__paymentLocalBus = { channels: new Map() };
  }
  return globalForBus.__paymentLocalBus;
}

/** Deliver to this process's current subscribers for the queue. Lookup is at
 * delivery time — the subscriber set may change between publish and Redis
 * echo, so it must not be captured in a closure. */
function deliver(queueId: string, message: SseMessage): void {
  const subscribers = localBus().channels.get(queueId);
  if (!subscribers) return;
  for (const subscriber of Array.from(subscribers)) {
    try {
      subscriber(message);
    } catch {
      // A broken pipe must never take down the writer of state changes.
      // The dead subscriber is cleaned up when its request aborts.
    }
  }
}

/** One Redis subscription per queue, shared by all local subscribers
 * (best-effort — a no-op when REDIS_URL is unset). */
async function ensureRedisSubscription(queueId: string): Promise<void> {
  const client = await getRedis("bus");
  if (!client) return;
  const subscribed = (globalForBus.__paymentRedisChannels ??= new Set());
  if (subscribed.has(queueId)) return;
  subscribed.add(queueId);
  try {
    await client.subscribe(`${CHANNEL_PREFIX}${queueId}`, (raw) => {
      let envelope: Envelope;
      try {
        envelope = JSON.parse(raw) as Envelope;
      } catch {
        return; // malformed — ignore
      }
      // Our own publishes were already delivered locally; skipping the echo
      // prevents double delivery.
      if (envelope.origin === INSTANCE_ID) return;
      deliver(queueId, envelope.message);
    });
  } catch {
    subscribed.delete(queueId); // retry on the next local subscribe()
  }
}

export function subscribe(queueId: string, subscriber: Subscriber): () => void {
  const { channels } = localBus();
  let set = channels.get(queueId);
  if (!set) {
    set = new Set();
    channels.set(queueId, set);
  }
  set.add(subscriber);

  void ensureRedisSubscription(queueId);

  return () => {
    const current = channels.get(queueId);
    if (!current) return;
    current.delete(subscriber);
    if (current.size === 0) channels.delete(queueId);
  };
}

export function publish(queueId: string, message: SseMessage): void {
  // 1. Local subscribers get the message synchronously.
  deliver(queueId, message);

  // 2. Other instances get it via Redis (best-effort, fire-and-forget).
  void (async () => {
    const client = await getRedis("bus");
    if (!client) return;
    const envelope: Envelope = { origin: INSTANCE_ID, message };
    try {
      await client.publish(`${CHANNEL_PREFIX}${queueId}`, JSON.stringify(envelope));
    } catch {
      // Redis down — local delivery already happened; the state write that
      // triggered this publish must never fail because of the bus.
    }
  })();
}

export function subscriberCount(queueId: string): number {
  return localBus().channels.get(queueId)?.size ?? 0;
}

