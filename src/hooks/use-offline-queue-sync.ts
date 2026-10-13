"use client";

import { useCallback, useEffect, useState } from "react";

import {
  listOutbox,
  syncOutbox,
  type OfflineQueueDraft,
} from "@/lib/offline/outbox";

/**
 * Owns the offline outbox lifecycle:
 * - exposes pending drafts + syncing state
 * - auto-syncs when the browser reports online (and on mount)
 * - `syncNow()` for manual retry from the offline banner
 */
export function useOfflineQueueSync() {
  const [drafts, setDrafts] = useState<OfflineQueueDraft[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(listOutbox());
  }, []);

  const syncNow = useCallback(async (): Promise<string[]> => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return [];
    if (listOutbox().length === 0) return [];
    setSyncing(true);
    try {
      const { drafts: next, syncedQueueIds } = await syncOutbox();
      setDrafts(next);
      if (syncedQueueIds.length > 0) setLastSyncedAt(new Date().toISOString());
      return syncedQueueIds;
    } finally {
      setSyncing(false);
      setDrafts(listOutbox());
    }
  }, []);

  useEffect(() => {
    const onOnline = () => void syncNow();
    window.addEventListener("online", onOnline);
    // Opportunistic sync on mount (covers "reloaded while back online").
    void syncNow();
    return () => window.removeEventListener("online", onOnline);
  }, [syncNow]);

  // Refresh the badge when another tab edits the outbox.
  useEffect(() => {
    const onStorage = () => setDrafts(listOutbox());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const refresh = useCallback(() => setDrafts(listOutbox()), []);

  return { drafts, pendingCount: drafts.length, syncing, lastSyncedAt, syncNow, refresh };
}
