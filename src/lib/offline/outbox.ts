/**
 * Offline outbox + snapshot cache.
 *
 * Write model: creating a PaymentQueue is the only mutation the client may
 * initiate offline. It is queued with its idempotencyKey and replayed with
 * the same key, so server-side dedupe (`idempotencyKey` unique) makes
 * retries safe — double-sync can never create two sessions.
 *
 * Read model: last-known QueueState per queueId is cached for offline
 * viewing. It is display-only and clearly labeled stale; progress still
 * requires server events over SSE.
 */

import { readJson, removeKey, writeJson } from "./storage";
import type { QueueState } from "@/lib/payment/types";

export interface OfflineQueueDraft {
  idempotencyKey: string;
  upiId: string;
  payeeName: string;
  note: string;
  amountsPaise: number[];
  uniqueAmounts: boolean;
  expiresInSecs: number;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  /** Filled after a successful sync so the UI can open the queue. */
  queueId: string | null;
}

const OUTBOX_KEY = "outbox";
const SNAPSHOT_PREFIX = "queue-snapshot:";
const FORM_DRAFT_KEY = "form-draft";
const MAX_OUTBOX = 20;
const MAX_SNAPSHOTS = 20;

function snapshotKey(queueId: string): string {
  return `${SNAPSHOT_PREFIX}${queueId}`;
}

/* ------------------------- outbox ------------------------- */

export function listOutbox(): OfflineQueueDraft[] {
  return readJson<OfflineQueueDraft[]>(OUTBOX_KEY, []);
}

function saveOutbox(drafts: OfflineQueueDraft[]): void {
  writeJson(OUTBOX_KEY, drafts.slice(0, MAX_OUTBOX));
}

export function enqueueDraft(
  draft: Omit<OfflineQueueDraft, "createdAt" | "attempts" | "lastError" | "queueId">
): OfflineQueueDraft[] {
  const current = listOutbox();
  if (current.some((d) => d.idempotencyKey === draft.idempotencyKey)) return current;
  const next: OfflineQueueDraft[] = [
    {
      ...draft,
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
      queueId: null,
    },
    ...current,
  ];
  saveOutbox(next);
  return next.slice(0, MAX_OUTBOX);
}

export function removeDraft(idempotencyKey: string): OfflineQueueDraft[] {
  const next = listOutbox().filter((d) => d.idempotencyKey !== idempotencyKey);
  saveOutbox(next);
  return next;
}

export function markDraftResult(
  idempotencyKey: string,
  patch: Partial<Pick<OfflineQueueDraft, "attempts" | "lastError" | "queueId">>
): OfflineQueueDraft[] {
  const next = listOutbox().map((d) =>
    d.idempotencyKey === idempotencyKey ? { ...d, ...patch } : d
  );
  saveOutbox(next);
  return next;
}

/** POST one draft; returns the server queueId on success. */
export async function syncDraft(draft: OfflineQueueDraft): Promise<string> {
  const response = await fetch("/api/payment-queues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      upiId: draft.upiId,
      payeeName: draft.payeeName,
      note: draft.note,
      amountsPaise: draft.amountsPaise,
      uniqueAmounts: draft.uniqueAmounts,
      expiresInSecs: draft.expiresInSecs,
      idempotencyKey: draft.idempotencyKey,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    queueId?: string;
  };
  if (!response.ok || !data.queueId) {
    throw new Error(data.error ?? `Sync failed (HTTP ${response.status}).`);
  }
  return data.queueId;
}

/**
 * Replay all pending drafts (oldest first). Successfully synced drafts are
 * removed from the outbox. Returns the updated list + per-draft results.
 */
export async function syncOutbox(): Promise<{
  drafts: OfflineQueueDraft[];
  syncedQueueIds: string[];
}> {
  const pending = [...listOutbox()].reverse();
  const syncedQueueIds: string[] = [];
  let drafts = listOutbox();
  for (const draft of pending) {
    if (draft.queueId) {
      drafts = removeDraft(draft.idempotencyKey);
      continue;
    }
    try {
      const queueId = await syncDraft(draft);
      syncedQueueIds.push(queueId);
      drafts = removeDraft(draft.idempotencyKey);
    } catch (err) {
      drafts = markDraftResult(draft.idempotencyKey, {
        attempts: draft.attempts + 1,
        lastError: err instanceof Error ? err.message : "Sync failed.",
      });
      // Stop on network failure; validation errors will retry next time but
      // should not block remaining drafts from attempting.
    }
  }
  return { drafts, syncedQueueIds };
}

/* ------------------------- snapshots ------------------------- */

interface SnapshotEntry {
  queueId: string;
  savedAt: string;
  state: QueueState;
}

export function saveQueueSnapshot(state: QueueState): void {
  const queueId = state.queue.id;
  const entry: SnapshotEntry = {
    queueId,
    savedAt: new Date().toISOString(),
    state,
  };
  writeJson(snapshotKey(queueId), entry);
  // Bound the index of known snapshots (best-effort LRU) and evict the
  // localStorage keys that fell off so the cache cannot grow unbounded.
  const index = readJson<string[]>("snapshot-index", []);
  const next = [queueId, ...index.filter((id) => id !== queueId)].slice(0, MAX_SNAPSHOTS);
  const evicted = index.filter((id) => id !== queueId && !next.includes(id));
  for (const id of evicted) removeKey(snapshotKey(id));
  writeJson("snapshot-index", next);
}

export function loadQueueSnapshot(queueId: string): SnapshotEntry | null {
  return readJson<SnapshotEntry | null>(snapshotKey(queueId), null);
}

/** Most-recent cached queue snapshots, newest first (for Activity lists). */
export function listSnapshots(): SnapshotEntry[] {
  const index = readJson<string[]>("snapshot-index", []);
  const entries: SnapshotEntry[] = [];
  for (const queueId of index) {
    const entry = loadQueueSnapshot(queueId);
    if (entry) entries.push(entry);
  }
  return entries;
}

export function clearQueueSnapshot(queueId: string): void {
  removeKey(snapshotKey(queueId));
  const index = readJson<string[]>("snapshot-index", []);
  if (index.includes(queueId)) {
    writeJson(
      "snapshot-index",
      index.filter((id) => id !== queueId)
    );
  }
}

/* ------------------------- form draft ------------------------- */

export interface FormDraft {
  upiId: string;
  payeeName: string;
  amount: string;
  note: string;
  uniqueMode: boolean;
}

export function loadFormDraft(): FormDraft | null {
  return readJson<FormDraft | null>(FORM_DRAFT_KEY, null);
}

export function saveFormDraft(draft: FormDraft): void {
  writeJson(FORM_DRAFT_KEY, draft);
}
