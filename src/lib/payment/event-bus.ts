import type { SseMessage } from "./types";

/**
 * In-process pub/sub used to push queue state changes to connected SSE
 * display devices.
 *
 * Single-instance only (matches this app's local-memory cache convention).
 * If the app is ever scaled horizontally, replace this module with Redis
 * pub/sub or Postgres LISTEN/NOTIFY — the API surface here is deliberately
 * tiny (`publish` / `subscribe`) to keep that swap trivial.
 */

export type Subscriber = (message: SseMessage) => void;

interface Bus {
  channels: Map<string, Set<Subscriber>>;
}

const globalForBus = globalThis as unknown as {
  __paymentEventBus: Bus | undefined;
};

function bus(): Bus {
  if (!globalForBus.__paymentEventBus) {
    globalForBus.__paymentEventBus = { channels: new Map() };
  }
  return globalForBus.__paymentEventBus;
}

export function subscribe(queueId: string, subscriber: Subscriber): () => void {
  const { channels } = bus();
  let set = channels.get(queueId);
  if (!set) {
    set = new Set();
    channels.set(queueId, set);
  }
  set.add(subscriber);

  return () => {
    const current = channels.get(queueId);
    if (!current) return;
    current.delete(subscriber);
    if (current.size === 0) channels.delete(queueId);
  };
}

export function publish(queueId: string, message: SseMessage): void {
  const set = bus().channels.get(queueId);
  if (!set) return;
  for (const subscriber of set) {
    try {
      subscriber(message);
    } catch {
      // A broken pipe must never take down the writer of state changes.
      // The dead subscriber is cleaned up when its request aborts.
    }
  }
}

export function subscriberCount(queueId: string): number {
  return bus().channels.get(queueId)?.size ?? 0;
}
