"use client";

import { useEffect, useState } from "react";
import { BellOff, CheckCheck, CloudOff, CloudUpload, Wifi, WifiOff } from "lucide-react";

import {
  listNotifications,
  markAllRead,
  subscribeNotifications,
  type AppNotification,
  type NotificationKind,
} from "@/lib/offline/notifications";

import { tapTick } from "./mobile-shell";

const KIND_ICON: Record<NotificationKind, typeof Wifi> = {
  queued: CloudOff,
  synced: CloudUpload,
  discarded: BellOff,
  offline: WifiOff,
  online: Wifi,
  completed: CheckCheck,
};

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return `${date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${time}`;
}

/**
 * Alerts inbox: every entry describes something that really happened on
 * this device (queued / synced / connectivity). Unread items are tinted
 * like EasyPay's notification list.
 */
export function AlertsScreen() {
  const [items, setItems] = useState<AppNotification[]>([]);

  useEffect(() => {
    // Post-hydration sync from device storage; SSR and first paint use [].
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount sync; cannot be computed during render without breaking hydration.
    setItems(listNotifications());
    return subscribeNotifications(() => {
      setItems(listNotifications());
    });
  }, []);

  return (
    <div className="ep-alerts">
      <header className="ep-pagehead ep-pagehead-row">
        <div>
          <h1>Notifications</h1>
          <p>Real events from this device only</p>
        </div>
        {items.some((n) => !n.read) ? (
          <button
            type="button"
            className="ep-viewall"
            onClick={() => {
              tapTick();
              setItems(markAllRead());
            }}
          >
            <CheckCheck size={12} aria-hidden="true" /> Mark all read
          </button>
        ) : null}
      </header>

      {items.length === 0 ? (
        <div className="ep-empty">
          <p>You&apos;re all caught up.</p>
          <p className="ep-muted">Offline queues, syncs, and connection changes will appear here.</p>
        </div>
      ) : (
        <ul className="ep-notifs">
          {items.map((item) => {
            const Icon = KIND_ICON[item.kind] ?? BellOff;
            return (
              <li key={item.id} className={item.read ? "ep-notif" : "ep-notif ep-notif-unread"}>
                <span className="ep-notif-tile" aria-hidden="true">
                  <Icon size={17} />
                </span>
                <span className="ep-notif-main">
                  <span className="ep-notif-title">{item.title}</span>
                  <span className="ep-notif-body">{item.body}</span>
                  <span className="ep-notif-when" title={formatWhen(item.createdAt)}>
                    {timeAgo(item.createdAt)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
