"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Bell, Eye, EyeOff, QrCode, ReceiptText, Share2, UserRound } from "lucide-react";

import { useOnline } from "@/hooks/use-online";
import { listOutbox } from "@/lib/offline/outbox";
import { listNotifications } from "@/lib/offline/notifications";
import type { MerchantProfile } from "@/lib/offline/notifications";
import { listSnapshots } from "@/lib/offline/outbox";
import type { QueueState } from "@/lib/payment/types";
import { formatINR } from "@/lib/upi";

import { tapTick } from "./mobile-shell";

interface SnapshotEntry {
  queueId: string;
  savedAt: string;
  state: QueueState;
}

interface HomeScreenProps {
  profile: MerchantProfile | null;
  onCollect: () => void;
  onHistory: () => void;
  onAlerts: () => void;
  onProfile: () => void;
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

/**
 * EasyPay-style home: greeting header, verified-collected hero card with
 * eye toggle, quick actions, and recent collections (all real, on-device).
 */
export function HomeScreen({ profile, onCollect, onHistory, onAlerts, onProfile }: HomeScreenProps) {
  const online = useOnline();
  const [hidden, setHidden] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [queued, setQueued] = useState(0);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    // Post-hydration sync from device storage; SSR and first paint use empties.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount sync; cannot be computed during render without breaking hydration.
    setSnapshots(listSnapshots());
    setQueued(listOutbox().length);
    setUnread(listNotifications().filter((n) => !n.read).length);
  }, []);

  const collected = snapshots.reduce((sum, s) => sum + s.state.collectedPaise, 0);
  const verifiedCount = snapshots.reduce((sum, s) => sum + s.state.paidCount, 0);
  const displayName = profile?.name.trim() || "Merchant";

  async function handleShareApp() {
    tapTick();
    const url = typeof window !== "undefined" ? `${window.location.origin}/app` : "/app";
    const text = `Collect UPI payments with QR19: ${url}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "QR19", text });
        return;
      }
      await navigator.clipboard.writeText(text);
    } catch {
      // share cancelled — nothing to do
    }
  }

  return (
    <div className="ep-home">
      <header className="ep-topbar">
        <div className="ep-user">
          <span className="ep-avatar" aria-hidden="true">
            {initials(displayName)}
          </span>
          <div>
            <p className="ep-hello">Hi, {displayName}</p>
            <p className="ep-sub">{profile?.upiId || (online ? "Merchant collection" : "Offline mode")}</p>
          </div>
        </div>
        <div className="ep-topbar-actions">
          <button type="button" className="ep-iconbtn" aria-label="Share QR19 app" onClick={handleShareApp}>
            <Share2 size={18} aria-hidden="true" />
          </button>
          <button type="button" className="ep-iconbtn" aria-label="Notifications" onClick={() => { tapTick(); onAlerts(); }}>
            <Bell size={18} aria-hidden="true" />
            {unread > 0 ? <span className="ep-dot-red" aria-label={`${unread} unread`} /> : null}
          </button>
        </div>
      </header>

      <section className="ep-hero" aria-label="Verified collected total">
        <p className="ep-hero-label">Verified collected · this device</p>
        <p className="ep-hero-amount">
          {hidden ? "₹ ••••••" : formatINR(collected)}
          <button
            type="button"
            className="ep-eye"
            aria-label={hidden ? "Show total" : "Hide total"}
            aria-pressed={hidden}
            onClick={() => { tapTick(); setHidden((v) => !v); }}
          >
            {hidden ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
          </button>
        </p>
        <p className="ep-hero-sub">
          {snapshots.length} collection{snapshots.length === 1 ? "" : "s"} · {verifiedCount} QR{verifiedCount === 1 ? "" : "s"} verified
          {queued > 0 ? ` · ${queued} queued offline` : ""}
        </p>
      </section>

      <div className="ep-actions ep-actions-grid">
        <button type="button" className="ep-action" onClick={() => { tapTick(); onCollect(); }}>
          <span className="ep-action-icon ep-tint-ink">
            <QrCode size={22} aria-hidden="true" />
          </span>
          <span>Collect</span>
        </button>
        <button type="button" className="ep-action" onClick={() => { tapTick(); onHistory(); }}>
          <span className="ep-action-icon ep-tint-blue">
            <ReceiptText size={22} aria-hidden="true" />
          </span>
          <span>History</span>
        </button>
        <button type="button" className="ep-action" onClick={handleShareApp}>
          <span className="ep-action-icon ep-tint-green">
            <Share2 size={22} aria-hidden="true" />
          </span>
          <span>Share</span>
        </button>
        <button type="button" className="ep-action" onClick={() => { tapTick(); onProfile(); }}>
          <span className="ep-action-icon ep-tint-amber">
            <UserRound size={22} aria-hidden="true" />
          </span>
          <span>Profile</span>
        </button>
      </div>

      <section aria-labelledby="ep-recent">
        <div className="ep-section-head">
          <h2 id="ep-recent">Recent</h2>
          <button type="button" className="ep-viewall" onClick={() => { tapTick(); onHistory(); }}>
            View all <ArrowUpRight size={12} aria-hidden="true" />
          </button>
        </div>
        {snapshots.length === 0 ? (
          <div className="ep-empty">
            <p>No collections yet on this device.</p>
            <button type="button" className="ep-btn ep-btn-sm" onClick={() => { tapTick(); onCollect(); }}>
              Start your first collection
            </button>
          </div>
        ) : (
          <ul className="ep-txns">
            {snapshots.slice(0, 3).map((snap) => {
              const done = snap.state.queue.status === "completed";
              return (
                <li key={snap.queueId}>
                  <button type="button" className="ep-txn" onClick={() => { tapTick(); onHistory(); }}>
                    <span className={done ? "ep-txn-tile ep-tint-green" : "ep-txn-tile ep-tint-amber"}>
                      {initials(snap.state.queue.payeeName)}
                    </span>
                    <span className="ep-txn-main">
                      <span className="ep-txn-name">{snap.state.queue.payeeName}</span>
                      <span className="ep-txn-sub">
                        {snap.state.paidCount}/{snap.state.queue.totalCount} paid · {timeAgo(snap.savedAt)}
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
    </div>
  );
}
