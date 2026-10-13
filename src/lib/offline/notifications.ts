/**
 * Device-local notification inbox for the mobile app.
 *
 * ONLY real, locally-observed events are recorded here: offline queue
 * activity (queued / synced / discarded), connectivity flips, and collection
 * completions seen on this device. Nothing is fabricated, and nothing leaves
 * the device — this is a log of things that actually happened.
 */

import { readJson, writeJson } from "./storage";

export type NotificationKind = "queued" | "synced" | "discarded" | "offline" | "online" | "completed";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

const KEY = "notifications";
const PROFILE_KEY = "merchant-profile";
const MAX_ITEMS = 30;

export interface MerchantProfile {
  name: string;
  upiId: string;
}

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `n-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

export function listNotifications(): AppNotification[] {
  const items = readJson<AppNotification[]>(KEY, []);
  return [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function unreadCount(): number {
  return listNotifications().filter((n) => !n.read).length;
}

export function pushNotification(input: Omit<AppNotification, "id" | "createdAt" | "read">): AppNotification[] {
  const entry: AppNotification = {
    ...input,
    id: uid(),
    createdAt: new Date().toISOString(),
    read: false,
  };
  // Dedupe connectivity flaps: collapse repeats of the same kind within 60s.
  const current = listNotifications();
  const prev = current[0];
  if (
    prev &&
    (input.kind === "offline" || input.kind === "online") &&
    prev.kind === input.kind &&
    Date.now() - new Date(prev.createdAt).getTime() < 60_000
  ) {
    return current;
  }
  const next = [entry, ...current].slice(0, MAX_ITEMS);
  writeJson(KEY, next);
  emitNotifications();
  return next;
}

export function markAllRead(): AppNotification[] {
  const next = listNotifications().map((n) => ({ ...n, read: true }));
  writeJson(KEY, next);
  emitNotifications();
  return next;
}

export function clearNotifications(): void {
  writeJson(KEY, []);
  emitNotifications();
}

/** Same-tab live updates: push/mark-all-read notify subscribers. */
const EVENT_NAME = "qr19:notifications";

function emitNotifications(): void {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    // ignore
  }
}

export function subscribeNotifications(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT_NAME, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT_NAME, listener);
    window.removeEventListener("storage", listener);
  };
}

/* ------------------------- merchant profile ------------------------- */

export function loadMerchantProfile(): MerchantProfile | null {
  return readJson<MerchantProfile | null>(PROFILE_KEY, null);
}

export function saveMerchantProfile(profile: MerchantProfile): void {
  writeJson(PROFILE_KEY, profile);
}
