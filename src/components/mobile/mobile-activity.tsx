"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { motion } from "framer-motion";
import { ArrowUpRight, LoaderCircle, X } from "lucide-react";

import { VerifiedPaymentMode } from "@/components/qr19/verified-payment-mode";
import { useOfflineQueueSync } from "@/hooks/use-offline-queue-sync";
import { useOnline } from "@/hooks/use-online";
import {
  listSnapshots,
  removeDraft,
} from "@/lib/offline/outbox";
import type { QueueState } from "@/lib/payment/types";
import { formatINR } from "@/lib/upi";

import { tapTick } from "./mobile-shell";

interface SnapshotRow {
  queueId: string;
  savedAt: string;
  state: QueueState;
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "₹";
  const parts = clean.split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const qrCache = new Map<string, string>();

async function qrImage(payload: string): Promise<string> {
  const hit = qrCache.get(payload);
  if (hit) return hit;
  const url = await QRCode.toDataURL(payload, {
    width: 640,
    margin: 3,
    errorCorrectionLevel: "M",
    color: { dark: "#182621", light: "#ffffff" },
  });
  qrCache.set(payload, url);
  return url;
}

/**
 * History: queued offline drafts plus verified collections, rendered as
 * EasyPay transaction rows. Tapping a collection opens its saved QR sheet
 * (re-rendered from the stored payloads — demo/live modes only; provider
 * modes never display the raw link) with a live-reopen action.
 */
export function HistoryScreen() {
  const online = useOnline();
  const { drafts, syncing, syncNow, refresh } = useOfflineQueueSync();
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [sheet, setSheet] = useState<SnapshotRow | null>(null);
  const [sheetImages, setSheetImages] = useState<Record<string, string>>({});
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState("");
  const [activeQueue, setActiveQueue] = useState<{ id: string; state: QueueState } | null>(null);

  useEffect(() => {
    setSnapshots(listSnapshots());
  }, []);

  useEffect(() => {
    if (!sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheet]);

  async function openSheet(snap: SnapshotRow) {
    tapTick();
    setSheet(snap);
    setSheetImages({});
    const mode = snap.state.mode;
    if (mode !== "demo" && mode !== "live") return;
    const entries = await Promise.all(
      snap.state.orders.map(async (order) => {
        try {
          return [order.orderId, await qrImage(order.qrPayload)] as const;
        } catch {
          return [order.orderId, ""] as const;
        }
      })
    );
    const map: Record<string, string> = {};
    for (const [orderId, image] of entries) {
      if (image) map[orderId] = image;
    }
    setSheetImages(map);
  }

  async function handleReopen(queueId: string) {
    if (!online || reopening) return;
    tapTick();
    setReopening(true);
    setReopenError("");
    try {
      const response = await fetch(`/api/payment-queues/${queueId}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Server returned ${response.status}.`);
      const state = (await response.json()) as QueueState;
      setSheet(null);
      setActiveQueue({ id: queueId, state });
    } catch (err) {
      setReopenError(err instanceof Error ? err.message : "Could not reopen.");
    } finally {
      setReopening(false);
    }
  }

  const collected = snapshots.reduce((sum, s) => sum + s.state.collectedPaise, 0);

  return (
    <div className="ep-history">
      <header className="ep-pagehead">
        <h1>History</h1>
        <p>{formatINR(collected)} verified · on this device</p>
      </header>

      {drafts.length > 0 ? (
        <section className="ep-card" aria-label="Queued offline">
          <div className="ep-section-head">
            <h2>Queued offline</h2>
            <button
              type="button"
              className="ep-viewall"
              onClick={() => { tapTick(); void syncNow().then(() => { refresh(); setSnapshots(listSnapshots()); }); }}
              disabled={syncing || !online}
            >
              {syncing ? <LoaderCircle size={12} className="loading-icon" aria-hidden="true" /> : null}
              Sync now <ArrowUpRight size={12} aria-hidden="true" />
            </button>
          </div>
          <ul className="ep-txns">
            {drafts.map((draft) => (
              <li key={draft.idempotencyKey} className="ep-txn ep-txn-static">
                <span className="ep-txn-tile ep-tint-amber">{initials(draft.payeeName)}</span>
                <span className="ep-txn-main">
                  <span className="ep-txn-name">{draft.payeeName}</span>
                  <span className="ep-txn-sub">Waiting for connection · {timeAgo(draft.createdAt)}</span>
                </span>
                <span className="ep-txn-amt">{formatINR(draft.amountsPaise.reduce((s, v) => s + v, 0))}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="ep-collections">
        <div className="ep-section-head">
          <h2 id="ep-collections">Collections</h2>
          <span className="ep-count">{snapshots.length}</span>
        </div>
        {snapshots.length === 0 ? (
          <div className="ep-empty">
            <p>No collections viewed on this device yet.</p>
            <p className="ep-muted">Start a collection and it will appear here with its QR sheet.</p>
          </div>
        ) : (
          <ul className="ep-txns ep-txns-card">
            {snapshots.map((snap) => {
              const done = snap.state.queue.status === "completed";
              const total = snap.state.orders.length;
              const paid = snap.state.paidCount;
              return (
                <li key={snap.queueId}>
                  <button type="button" className="ep-txn" onClick={() => openSheet(snap)}>
                    <span className={done ? "ep-txn-tile ep-tint-green" : "ep-txn-tile ep-tint-blue"}>
                      {initials(snap.state.queue.payeeName)}
                    </span>
                    <span className="ep-txn-main">
                      <span className="ep-txn-name">{snap.state.queue.payeeName}</span>
                      <span className="ep-txn-sub">
                        {done ? "Completed" : `${paid}/${total} paid`} · {timeAgo(snap.savedAt)}
                      </span>
                    </span>
                    <span className="ep-txn-amt">{formatINR(snap.state.queue.totalPaise)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {sheet ? (
        <div className="ep-zoom" role="dialog" aria-modal="true" aria-label={`Saved QR sheet for ${sheet.state.queue.payeeName}`}>
          <div className="ep-zoom-bg" onClick={() => setSheet(null)} aria-hidden="true" />
          <motion.div
            className="ep-sheet ep-sheet-wide"
            initial={{ opacity: 0, y: 48 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <span className="ep-handle" aria-hidden="true" />
            <h2 className="ep-sheet-title">{sheet.state.queue.payeeName}</h2>
            <p className="ep-sheet-sub">
              {formatINR(sheet.state.queue.totalPaise)} · {sheet.state.paidCount}/{sheet.state.queue.totalCount} verified
            </p>
            {(sheet.state.mode === "demo" || sheet.state.mode === "live") ? (
              <div className="ep-sheet-grid">
                {sheet.state.orders.map((order, index) => {
                  const image = sheetImages[order.orderId];
                  return (
                    <figure key={order.orderId} className="ep-sheet-qr">
                      <figcaption>
                        {index + 1} · {order.status}
                      </figcaption>
                      {image ? (
                        <img src={image} alt={`Saved QR ${index + 1}: ${formatINR(order.amountPaise)}`} width={140} height={140} />
                      ) : (
                        <span className="ep-sheet-loading" aria-hidden="true" />
                      )}
                      <strong>{formatINR(order.amountPaise)}</strong>
                    </figure>
                  );
                })}
              </div>
            ) : (
              <p className="ep-muted">
                These QRs are hosted by your payment provider — open the live collection instead of reusing codes.
              </p>
            )}
            <div className="ep-ctarow">
              <button
                type="button"
                className="ep-btn ep-btn-flex"
                disabled={!online || reopening}
                onClick={() => handleReopen(sheet.queueId)}
              >
                {reopening ? <LoaderCircle size={16} className="loading-icon" aria-hidden="true" /> : null}
                {reopening ? "Opening…" : "Open live collection"}
              </button>
              <button type="button" className="ep-squarebtn" onClick={() => setSheet(null)} aria-label="Close saved QR sheet">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {reopenError ? (
              <p className="ep-error" role="alert">{reopenError}</p>
            ) : null}
            {!online ? (
              <p className="ep-muted">You are offline — live reopen needs a connection.</p>
            ) : null}
          </motion.div>
        </div>
      ) : null}

      {drafts.length > 0 && (
        <div className="ep-pending" aria-label="Discard queued drafts">
          {drafts.slice(0, 2).map((draft) => (
            <div key={draft.idempotencyKey} className="ep-pending-row">
              <span>Queued: {draft.payeeName}</span>
              <button
                type="button"
                className="ep-pending-dismiss"
                onClick={() => {
                  tapTick();
                  removeDraft(draft.idempotencyKey);
                  refresh();
                }}
                aria-label={`Discard queued collection for ${draft.payeeName}`}
              >
                Discard
              </button>
            </div>
          ))}
        </div>
      )}

      {activeQueue ? (
        <VerifiedPaymentMode
          queueId={activeQueue.id}
          initialState={activeQueue.state}
          onClose={() => {
            setActiveQueue(null);
            setSnapshots(listSnapshots());
          }}
          onNewCollection={() => setActiveQueue(null)}
        />
      ) : null}
    </div>
  );
}
