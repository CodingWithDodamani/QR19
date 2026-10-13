/**
 * Offline storage primitives for QR19.
 *
 * Server remains authoritative for payment progress (only
 * `processProviderEvent()` may set `paid`). Offline storage is used for:
 * - queue-creation outbox drafts (synced via idempotent POST on reconnect)
 * - last-known QueueState snapshots (read-only cache for offline viewing)
 * - form draft persistence (merchant input survives reload / offline)
 *
 * Backed by localStorage for broad iOS/Android WebView support.
 * All helpers are safe to call during SSR (no-op) and in private mode
 * (quota errors are swallowed). Swap to IndexedDB later without changing
 * callers — keep the function signatures stable.
 */

const PREFIX = "qr19.offline.v1.";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota / private mode — offline cache is best-effort only.
  }
}

export function removeKey(key: string): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
