"use client";

import { CloudOff, CloudUpload, LoaderCircle, WifiOff } from "lucide-react";

import { useOnline } from "@/hooks/use-online";

interface OfflineBannerProps {
  /** Drafts waiting in the outbox. */
  pendingCount?: number;
  syncing?: boolean;
  onRetry?: () => void;
  /** Compact variant for inside the collection overlay. */
  variant?: "bar" | "inline";
  /** Extra context, e.g. "Showing cached QR — progress needs connection." */
  message?: string;
}

/**
 * Cross-platform offline / pending-sync indicator.
 * - 44px+ touch target on the retry button (iOS HIG / Android Material)
 * - safe-area aware (see `.offline-banner` in globals.css)
 * - purely presentational: never blocks the underlying form
 */
export function OfflineBanner({
  pendingCount = 0,
  syncing = false,
  onRetry,
  variant = "bar",
  message,
}: OfflineBannerProps) {
  const online = useOnline();
  if (online && pendingCount === 0) return null;

  const offline = !online;
  const text = offline
    ? message ?? "You are offline. New collections will be queued and synced automatically."
    : `${pendingCount} collection${pendingCount === 1 ? "" : "s"} waiting to sync.`;

  return (
    <div
      className={variant === "inline" ? "offline-banner-inline" : "offline-banner"}
      role="status"
      aria-live="polite"
    >
      <span className="offline-banner-icon" aria-hidden="true">
        {offline ? <WifiOff size={15} /> : <CloudOff size={15} />}
      </span>
      <span className="offline-banner-text">{text}</span>
      {!offline && pendingCount > 0 && onRetry && (
        <button
          type="button"
          className="offline-banner-retry"
          onClick={onRetry}
          disabled={syncing}
          aria-label={`Retry syncing ${pendingCount} pending collections`}
        >
          {syncing ? (
            <LoaderCircle size={14} className="loading-icon" aria-hidden="true" />
          ) : (
            <CloudUpload size={14} aria-hidden="true" />
          )}
          {syncing ? "Syncing…" : `Sync now${pendingCount > 0 ? ` (${pendingCount})` : ""}`}
        </button>
      )}
    </div>
  );
}
