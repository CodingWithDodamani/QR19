"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  BadgeCheck,
  Banknote,
  Check,
  CircleAlert,
  Clock,
  Copy,
  ExternalLink,
  History,
  Info,
  Printer,
  RadioTower,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";

import { PaytmIcon, PhonePeIcon } from "@/components/upi-pay/app-icons";
import { OfflineBanner } from "@/components/offline/offline-banner";
import { useOnline } from "@/hooks/use-online";
import { loadQueueSnapshot, saveQueueSnapshot } from "@/lib/offline/outbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatINR } from "@/lib/upi";
import type {
  Notice,
  OrderDTO,
  OrderStatus,
  QueueState,
  SseMessage,
} from "@/lib/payment/types";

/**
 * Verified sequential payment display.
 *
 * Shows ONLY the current payable QR. The next QR appears automatically —
 * with a swipe-away animation — once the payment provider confirms the
 * current payment on the backend. The client never decides that a payment
 * succeeded: server state (pushed over SSE) is the single source of truth,
 * and every reconnect/replace-from-server is a full resync.
 */

const PAYABLE: OrderStatus[] = ["pending", "displayed"];
const TERMINAL: OrderStatus[] = ["paid", "expired", "cancelled", "failed", "skipped"];

const QR_OPTIONS = {
  width: 720,
  margin: 4,
  errorCorrectionLevel: "M" as const,
  color: { dark: "#182621", light: "#ffffff" },
};

type Connection = "connecting" | "live" | "reconnecting";

type CompletionTone = "celebrate" | "cancelled";

/* ------------------------------------------------------------------ */
/* Fraud Shield (server anti-fraud state)                              */
/* ------------------------------------------------------------------ */

interface SecurityAlert {
  id: string;
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
  count: number;
  orderId: string | null;
  lastSeenAt: string;
}

interface QueueSecurity {
  mode: string;
  serverVerified: boolean;
  alerts: SecurityAlert[];
  guarantees: { key: string; text: string }[];
}

const FALLBACK_GUARANTEES = [
  "Every QR is a single-use order bound to its own reference, amount and expiry.",
  "Even ₹1 short never completes a QR — the server checks the exact amount.",
  "Screenshots and SMS “proof” are never an input — only the provider's own confirmation counts.",
  "One payment can complete exactly one QR; reuse is blocked and alarmed.",
];

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/* ------------------------------------------------------------------ */
/* SSE hook — real-time push + resync                                  */
/* ------------------------------------------------------------------ */

function usePaymentQueueSse(
  queueId: string,
  initialState: QueueState,
  onNotice: (notice: Notice) => void
) {
  const [state, setState] = useState<QueueState>(() => {
    // Offline reopen: fall back to the last cached snapshot when the passed
    // initial state has no current order (caller may hydrate from cache).
    if (typeof window !== "undefined") {
      const cached = loadQueueSnapshot(queueId);
      if (cached && !initialState.current) return cached.state;
    }
    return initialState;
  });
  const [connection, setConnection] = useState<Connection>("connecting");
  const onNoticeRef = useRef(onNotice);

  useEffect(() => {
    onNoticeRef.current = onNotice;
  }, [onNotice]);

  useEffect(() => {
    saveQueueSnapshot(initialState);
  }, [queueId, initialState]);

  const resync = useCallback(async () => {
    try {
      const response = await fetch(`/api/payment-queues/${queueId}`, {
        cache: "no-store",
      });
      if (response.ok) {
        const fresh = (await response.json()) as QueueState;
        setState(fresh);
        saveQueueSnapshot(fresh);
      }
    } catch {
      // Offline; the SSE reconnect or the next resync will catch up.
    }
  }, [queueId]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      setConnection((current) => (current === "live" ? "live" : "connecting"));
      source = new EventSource(`/api/payment-queues/${queueId}/events`);

      source.onopen = () => setConnection("live");

      source.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as SseMessage;
          if (message.type === "state") {
            setConnection("live");
            setState(message.state);
            saveQueueSnapshot(message.state);
          } else if (message.type === "notice") {
            onNoticeRef.current?.(message.notice);
          }
        } catch {
          // Ignore malformed frames; the next snapshot corrects everything.
        }
      };

      source.onerror = () => {
        setConnection("reconnecting");
        source?.close();
        source = null;
        if (!stopped) {
          // EventSource would auto-reconnect, but we own the loop so the
          // initial snapshot on every fresh connection acts as the resync.
          retryTimer = window.setTimeout(connect, 1800);
        }
      };
    };

    // Full resync from the server (never from local animation state) when
    // the tab becomes visible again or the network returns — this covers
    // "payment succeeded while the screen was backgrounded".
    const onVisibility = () => {
      if (document.visibilityState === "visible") void resync();
    };
    const onOnline = () => void resync();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    connect();

    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      source?.close();
    };
  }, [queueId, resync]);

  return { state, connection, refresh: resync };
}

/* ------------------------------------------------------------------ */
/* QR image (local render OR real provider QR via server proxy)        */
/* ------------------------------------------------------------------ */

/** Which artifact the QR area renders for this order. */
type QrKind = "razorpay" | "paytm" | "phonepe" | null;

function QrImage({
  order,
  cache,
  alt,
  providerKind,
}: {
  order: OrderDTO;
  cache: Map<string, string>;
  alt: string;
  providerKind: QrKind;
}) {
  const [src, setSrc] = useState<string | undefined>(() =>
    providerKind === "razorpay" && order.providerQrId
      ? `/api/psp/qr-image/${order.providerQrId}`
      : providerKind
        ? undefined
        : cache.get(order.orderId)
  );
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let alive = true;

    // Razorpay modes: display the REAL PSP-generated QR through the app's
    // own proxy. The raw `qrPayload` (a direct UPI link to the merchant
    // VPA) is deliberately NOT rendered here — paying it would bypass the
    // provider and could never be verified.
    if (providerKind === "razorpay") {
      queueMicrotask(() => {
        if (!alive) return;
        setImageFailed(false);
        setSrc(order.providerQrId ? `/api/psp/qr-image/${order.providerQrId}` : undefined);
      });
      return () => {
        alive = false;
      };
    }

    // PhonePe modes: there is no QR at all (PhonePe hosts a payment page
    // instead) — the parent renders the page CTA once paymentPageUrl is
    // known; until then we only show the honest preparing state.
    if (providerKind === "phonepe") {
      return () => {
        alive = false;
      };
    }

    // Paytm modes: after provisioning, `qrPayload` holds Paytm's OWN dynamic
    // QR data (upi://… into the merchant's Paytm account) — safe to render
    // locally. Before provisioning it is still the raw merchant link, which
    // must never be displayed (it would bypass Paytm entirely).
    if (providerKind === "paytm" && !order.providerQrCreatedAt) {
      return () => {
        alive = false;
      };
    }

    const cached = providerKind ? undefined : cache.get(order.orderId);
    if (cached) {
      // Deferred (not synchronous) so a cache hit can't cascade renders.
      queueMicrotask(() => {
        if (!alive) return;
        setImageFailed(false);
        setSrc(cached);
      });
      return () => {
        alive = false;
      };
    }
    QRCode.toDataURL(order.qrPayload, QR_OPTIONS)
      .then((url) => {
        cache.set(order.orderId, url);
        if (alive) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [order.orderId, order.qrPayload, order.providerQrId, order.providerQrCreatedAt, providerKind, cache]);

  if (providerKind) {
    if (providerKind === "razorpay" && order.providerQrId && src && !imageFailed) {
      return (
        <img
          src={src}
          alt={alt}
          width={218}
          height={218}
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      );
    }
    if (providerKind === "razorpay" && order.providerQrId && imageFailed) {
      return (
        <div className="pv-qr-issue" role="status">
          <CircleAlert size={16} aria-hidden="true" />
          <span>The provider’s QR image could not be loaded. It will retry automatically.</span>
        </div>
      );
    }
    if (order.providerQrError) {
      return (
        <div className="pv-qr-issue pv-qr-issue-error" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{order.providerQrError}</span>
        </div>
      );
    }
    return (
      <div className="pv-qr-preparing" role="status">
        <span className="pv-qr-loading" aria-hidden="true" />
        <span>
          {providerKind === "paytm"
            ? "Requesting this dynamic QR from Paytm…"
            : providerKind === "phonepe"
              ? "Requesting the PhonePe payment page…"
              : "Requesting this QR from the payment provider…"}
        </span>
      </div>
    );
  }

  if (!src) {
    return <div className="pv-qr-loading" aria-hidden="true" />;
  }

  return <img src={src} alt={alt} width={218} height={218} draggable={false} />;
}

/* ------------------------------------------------------------------ */
/* PhonePe hosted payment page (no QR exists for PAY_PAGE)             */
/* ------------------------------------------------------------------ */

function PhonePePageCard({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <div className="flex items-center gap-2 text-[#5F259F]">
        <PhonePeIcon className="size-6" aria-hidden="true" />
        <span className="text-sm font-semibold">PhonePe payment page</span>
      </div>
      <a
        className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#5F259F] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <ExternalLink size={14} aria-hidden="true" />
        Open PhonePe payment page
      </a>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
        }
        aria-label="Copy the PhonePe payment page link"
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {copied ? "Link copied" : "Copy link"}
      </Button>
      <p className="max-w-[280px] text-xs leading-relaxed text-[#65748b]">
        PhonePe hosts this payment page; the server verifies payment through
        PhonePe’s status API. No QR is shown — PhonePe does not issue a
        scannable QR string for this flow.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const STAMP_TONE: Record<string, string> = {
  paid: "pv-stamp-paid",
  skipped: "pv-stamp-skipped",
  expired: "pv-stamp-expired",
  failed: "pv-stamp-failed",
  cancelled: "pv-stamp-cancelled",
};

const STAMP_LABEL: Record<string, string> = {
  paid: "PAID",
  skipped: "SKIPPED",
  expired: "EXPIRED",
  failed: "FAILED",
  cancelled: "CANCELLED",
};

const STATUS_CHIP: Record<string, string> = {
  paid: "pv-chip-paid",
  displayed: "pv-chip-displayed",
  pending: "pv-chip-pending",
  skipped: "pv-chip-skipped",
  expired: "pv-chip-expired",
  failed: "pv-chip-failed",
  cancelled: "pv-chip-cancelled",
};

/** Human label per PSP pipeline mode (used by the live-verification panel). */
const PROVIDER_LABEL: Record<string, string> = {
  "razorpay-test": "Razorpay test",
  "razorpay-live": "Razorpay live",
  "phonepe-test": "PhonePe UAT",
  "phonepe-live": "PhonePe live",
  "paytm-test": "Paytm staging",
  "paytm-live": "Paytm live",
};

function NoticeIcon({ kind }: { kind: Notice["kind"] }) {
  const size = 14;
  switch (kind) {
    case "payment_declined":
      return <CircleAlert size={size} aria-hidden="true" />;
    case "amount_mismatch":
      return <TriangleAlert size={size} aria-hidden="true" />;
    case "order_expired":
      return <Clock size={size} aria-hidden="true" />;
    case "order_terminated":
      return <XCircle size={size} aria-hidden="true" />;
    default:
      return <Info size={size} aria-hidden="true" />;
  }
}

function formatCountdown(ms: number): string {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * Plain-text reconciliation receipt for the end-of-collection screen:
 * one line per QR with status, amount and provider transaction reference.
 * Copy-friendly — merchants forward it to an owner/manager or paste it into
 * their ledger. Same data the payment-history list shows, as text.
 */
function buildReceiptText(state: QueueState): string {
  const lines: string[] = [];
  lines.push(`QR19 collection receipt`);
  lines.push(`Payee: ${state.queue.payeeName} (${state.queue.upiId})`);
  if (state.queue.note) lines.push(`Note: ${state.queue.note}`);
  lines.push(
    `Session: ${new Date(state.queue.createdAt).toLocaleString("en-IN")}`
  );
  lines.push("");
  for (const order of state.orders) {
    const paidAt = order.paidAt
      ? new Date(order.paidAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
      : "";
    const ref = order.providerRef ? ` · ref ${order.providerRef}` : "";
    const time = paidAt ? ` at ${paidAt}` : "";
    lines.push(`#${order.seq} ${formatINR(order.amountPaise)} — ${order.status.toUpperCase()}${time}${ref} [${order.orderId}]`);
  }
  lines.push("");
  lines.push(
    `Verified received: ${formatINR(state.collectedPaise)} (${state.paidCount}/${state.queue.totalCount} payments)`
  );
  const unpaid = state.orders.filter(
    (o) => o.status !== "paid" && o.status !== "pending"
  );
  if (unpaid.length > 0) {
    lines.push(
      `Not collected: ${unpaid.length} QR (${unpaid
        .map((o) => `#${o.seq} ${o.status}`)
        .join(", ")})`
    );
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

interface VerifiedPaymentModeProps {
  queueId: string;
  initialState: QueueState;
  onClose: () => void;
  onNewCollection: () => void;
}

export function VerifiedPaymentMode({
  queueId,
  initialState,
  onClose,
  onNewCollection,
}: VerifiedPaymentModeProps) {
  const reduce = useReducedMotion() ?? false;
  const [mounted, setMounted] = useState(false);

  /* ---- transient notices (declines, mismatches, expiry…) ---- */
  const [notices, setNotices] = useState<Notice[]>([]);
  const addNotice = useCallback((notice: Notice) => {
    setNotices((currentList) => [...currentList.slice(-2), notice]);
    window.setTimeout(() => {
      setNotices((currentList) => currentList.filter((n) => n.id !== notice.id));
    }, 8000);
  }, []);

  const { state, connection, refresh } = usePaymentQueueSse(queueId, initialState, addNotice);

  /* ----- display state machine (animation is presentational only) ----- */
  const [displayId, setDisplayId] = useState<string | null>(
    initialState.current?.orderId ?? null
  );
  const [stampFor, setStampFor] = useState<string | null>(null);
  const [complete, setComplete] = useState<CompletionTone | null>(
    initialState.current
      ? null
      : initialState.queue.status === "cancelled"
        ? "cancelled"
        : "celebrate"
  );

  const stateRef = useRef<QueueState>(initialState);
  const handledRef = useRef<Set<string>>(new Set());
  const afterExitRef = useRef<(() => void) | null>(null);
  const dwellRef = useRef<number | null>(null);
  const qrCache = useRef<Map<string, string>>(new Map());

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  /* ---- prefetch upcoming QR payloads in the background (never shown) --
   *  Only for locally-rendered modes. In PSP modes the real artifact is
   *  provisioned server-side on demand, one order at a time. */
  useEffect(() => {
    if (state.mode !== "demo" && state.mode !== "live") return;
    const upcoming = state.orders.filter((o) => PAYABLE.includes(o.status)).slice(0, 3);
    for (const order of upcoming) {
      if (!qrCache.current.has(order.orderId)) {
        QRCode.toDataURL(order.qrPayload, QR_OPTIONS)
          .then((url) => qrCache.current.set(order.orderId, url))
          .catch(() => undefined);
      }
    }
  }, [state]);

  /* ---- advance logic: fresh state, walk-through intermediate steps ---- */
  const pickNext = useCallback(
    (fromSeq: number) => {
      const latest = stateRef.current;
      const current = latest?.current ?? null;
      const between = latest
        ? latest.orders.filter(
            (o) =>
              o.seq > fromSeq &&
              (!current || o.seq < current.seq) &&
              TERMINAL.includes(o.status)
          )
        : [];

      if (between.length > 0) {
        // Rapid successive payments: flash each settled order briefly so
        // none of them is skipped visually, then land on the live one.
        const step = between[0];
        handledRef.current.add(step.orderId);
        setDisplayId(step.orderId);
        dwellRef.current = window.setTimeout(() => {
          dwellRef.current = null;
          setStampFor(step.orderId);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              afterExitRef.current = () => pickNext(step.seq);
              setDisplayId(null);
            })
          );
        }, reduce ? 500 : 950);
        return;
      }

      setDisplayId(current ? current.orderId : null);
      if (!current) {
        const queueStatus = latest?.queue.status;
        window.setTimeout(
          () => setComplete(queueStatus === "cancelled" ? "cancelled" : "celebrate"),
          reduce ? 250 : 430
        );
      }
    },
    [reduce]
  );

  /* ---- react to server-side status changes ---- */
  useEffect(() => {
    stateRef.current = state;

    if (complete) return;
    const shown = displayId ? state.orders.find((o) => o.orderId === displayId) : undefined;
    if (!displayId || !shown) return;
    if (PAYABLE.includes(shown.status)) return; // still the live QR
    if (handledRef.current.has(shown.orderId)) return; // exit already queued

    // The displayed order just became terminal on the server — animate it
    // away. First commit the stamped card, then (next frames) start the
    // exit so AnimatePresence's snapshot includes the stamp.
    handledRef.current.add(shown.orderId);
    setStampFor(shown.orderId);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        afterExitRef.current = () => pickNext(shown.seq);
        setDisplayId(null);
      })
    );
  }, [state, displayId, complete, pickNext]);

  const handleExitComplete = useCallback(() => {
    const after = afterExitRef.current;
    afterExitRef.current = null;
    setStampFor(null);
    after?.();
  }, []);

  useEffect(
    () => () => {
      if (dwellRef.current) window.clearTimeout(dwellRef.current);
    },
    []
  );

  /* ---- 1s ticker for the expiry countdown ---- */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const current = state.current;
  const displayOrder = displayId ? state.orders.find((o) => o.orderId === displayId) : undefined;
  const serverSkew = now - new Date(state.serverTime).getTime();
  const expiresInMs = current ? new Date(current.expiresAt).getTime() - (now - serverSkew) : 0;
  const nextPayable = state.orders.find(
    (o) => o.seq > (current?.seq ?? 0) && PAYABLE.includes(o.status)
  );

  const paidProgress = state.queue.totalCount
    ? (state.paidCount / state.queue.totalCount) * 100
    : 0;

  /* ---- demo console + staff actions ---- */
  const [simBusy, setSimBusy] = useState<string | null>(null);
  /* Secondary simulators live behind a training disclosure so the demo
   * screen reads like the real product (one primary action). */
  const [simTrainingOpen, setSimTrainingOpen] = useState(false);

  const simulate = useCallback(
    async (outcome: "success" | "declined" | "wrong_amount" | "duplicate_success" | "replayed_proof") => {
      if (!current || simBusy) return;
      setSimBusy(outcome);
      try {
        const response = await fetch(`/api/payment-queues/${queueId}/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: current.orderId, outcome }),
        });
        const data = (await response.json()) as { error?: string; handled?: boolean; reason?: string };
        if (!response.ok) {
          addNotice({
            id: `sim-${Date.now()}`,
            kind: "payment_declined",
            message: data.error ?? "Simulation failed.",
          });
        } else if (data.handled === false && connection !== "live") {
          // SSE is down, so its notice never arrived — surface the server's
          // business rejection (duplicate, mismatch…) directly. When SSE is
          // live, the pushed notice already covers this.
          addNotice({
            id: `sim-${Date.now()}`,
            kind: "already_paid",
            message: `Provider event not applied (${data.reason}).`,
          });
        }
        if (connection !== "live") await refresh();
      } finally {
        setSimBusy(null);
      }
    },
    [current, queueId, simBusy, addNotice, connection, refresh]
  );

  /* ---- Fraud Shield state: guarantees + live fraud alerts ---- */
  const [security, setSecurity] = useState<QueueSecurity | null>(null);
  const [shieldOpen, setShieldOpen] = useState(false);

  const refreshSecurity = useCallback(async () => {
    try {
      const response = await fetch(`/api/payment-queues/${queueId}/security`, {
        cache: "no-store",
      });
      if (response.ok) setSecurity((await response.json()) as QueueSecurity);
    } catch {
      // transient — the next poll or SSE notice refetches
    }
  }, [queueId]);

  useEffect(() => {
    void refreshSecurity();
    const timer = window.setInterval(() => void refreshSecurity(), 15_000);
    return () => window.clearInterval(timer);
  }, [refreshSecurity]);

  // Fraud signals usually arrive alongside a notice — refetch immediately
  // so the shield lights up without waiting for the 15s poll.
  useEffect(() => {
    if (notices.length > 0) void refreshSecurity();
  }, [notices.length, refreshSecurity]);

  /* ---- merchant-initiated provider re-check ("payment ho gaya!") ---- */
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const verifyNow = useCallback(async () => {
    if (verifyBusy) return;
    setVerifyBusy(true);
    try {
      const response = await fetch(`/api/payment-queues/${queueId}/verify-now`, {
        method: "POST",
      });
      const data = (await response.json()) as {
        message?: string;
        error?: string;
        verified?: boolean;
      };
      setVerifyMsg({
        ok: Boolean(data.verified),
        text: data.message ?? data.error ?? `Check failed (HTTP ${response.status}).`,
      });
      window.setTimeout(() => setVerifyMsg(null), 9000);
      if (connection !== "live") await refresh();
      void refreshSecurity();
    } catch {
      setVerifyMsg({ ok: false, text: "Could not reach the server to verify." });
    } finally {
      setVerifyBusy(false);
    }
  }, [queueId, verifyBusy, connection, refresh, refreshSecurity]);

  const [staffOpen, setStaffOpen] = useState(false);
  const [staffReason, setStaffReason] = useState("");
  const [staffBusy, setStaffBusy] = useState(false);
  const [armed, setArmed] = useState<"skip" | "cancel" | null>(null);

  /* ---- signed webhook test (Razorpay TEST mode only) ---- */
  const [webhookTestBusy, setWebhookTestBusy] = useState(false);

  const sendWebhookTest = useCallback(async () => {
    if (webhookTestBusy) return;
    setWebhookTestBusy(true);
    try {
      const response = await fetch(`/api/payment-queues/${queueId}/webhook-test`, {
        method: "POST",
      });
      const data = (await response.json()) as { error?: string; delivered?: boolean };
      if (!response.ok || data.delivered === false) {
        addNotice({
          id: `wtest-${Date.now()}`,
          kind: "payment_declined",
          message: `Webhook test failed: ${data.error ?? `HTTP ${response.status}`}`,
        });
      } else if (connection !== "live") {
        await refresh();
      }
    } catch {
      addNotice({
        id: `wtest-${Date.now()}`,
        kind: "payment_declined",
        message: "Webhook test could not be delivered.",
      });
    } finally {
      setWebhookTestBusy(false);
    }
  }, [queueId, webhookTestBusy, addNotice, connection, refresh]);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), 3500);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const runOverride = useCallback(
    async (action: "skip" | "cancel") => {
      if (staffBusy) return;
      setStaffBusy(true);
      try {
        // P0-2: staff overrides are operator-only — attach the saved ADMIN_TOKEN.
        const saved =
          typeof window !== "undefined"
            ? window.sessionStorage.getItem("qr19-admin-token")
            : null;
        const authHeader: Record<string, string> = saved
          ? { Authorization: `Bearer ${saved}` }
          : {};
        if (action === "skip" && current) {
          await fetch(`/api/payment-queues/${queueId}/orders/${current.orderId}/override`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify({ action: "skip", reason: staffReason }),
          });
        } else if (action === "cancel") {
          await fetch(`/api/payment-queues/${queueId}/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify({ reason: staffReason }),
          });
        }
        setStaffReason("");
        setArmed(null);
        if (connection !== "live") await refresh();
      } finally {
        setStaffBusy(false);
      }
    },
    [staffBusy, current, queueId, staffReason, connection, refresh]
  );

  const [historyOpen, setHistoryOpen] = useState(false);

  /* ---- end-of-collection receipt (copy / print) ---- */
  const [copiedReceipt, setCopiedReceipt] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const receiptText = useMemo(
    () => (complete ? buildReceiptText(state) : ""),
    [complete, state]
  );

  const copyReceipt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(receiptText);
      setCopiedReceipt(true);
      window.setTimeout(() => setCopiedReceipt(false), 2000);
    } catch {
      // Clipboard unavailable (permissions/insecure origin) — ignore.
    }
  }, [receiptText]);

  /** Force the receipt <details> open before printing — a collapsed
   * <details> hides its children and would print an empty sheet. */
  const printReceipt = useCallback(() => {
    setReceiptOpen(true);
    window.setTimeout(() => window.print(), 80);
  }, []);

  /* ---- keyboard + focus trap + scroll lock ---- */
  useEffect(() => {
    function handleTab(event: KeyboardEvent) {
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex='-1'])"
        )
      ).filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") handleTab(event);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  /* ---- confetti ---- */
  const confettiPieces = useMemo(() => {
    if (complete !== "celebrate") return [];
    const colors = ["#635bff", "#2bb673", "#16754b", "#c86dd7", "#f5b942", "#9d7bff"];
    return Array.from({ length: 46 }, (_, index) => ({
      id: index,
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 1.4}s`,
      duration: `${2.4 + Math.random() * 1.8}s`,
      color: colors[index % colors.length],
      size: 5 + Math.round(Math.random() * 6),
      drift: `${(Math.random() - 0.5) * 180}px`,
      round: Math.random() > 0.5,
    }));
  }, [complete]);

  const isDemo = state.mode === "demo";
  const isRzpTest = state.mode === "razorpay-test";
  const isRzpLive = state.mode === "razorpay-live";
  const isPhonepeTest = state.mode === "phonepe-test";
  const isPhonepeLive = state.mode === "phonepe-live";
  const isPaytmTest = state.mode === "paytm-test";
  const isPaytmLive = state.mode === "paytm-live";
  const isPhonepeMode = isPhonepeTest || isPhonepeLive;
  const isPaytmMode = isPaytmTest || isPaytmLive;
  const isProviderMode =
    isRzpTest || isRzpLive || isPhonepeMode || isPaytmMode;
  const qrKind: QrKind = isRzpTest || isRzpLive ? "razorpay" : isPaytmMode ? "paytm" : isPhonepeMode ? "phonepe" : null;
  const connLabel =
    connection === "live" ? "Live" : connection === "reconnecting" ? "Reconnecting…" : "Connecting…";

  /* Live verification (PSP modes): which merchant credential confirms
   * payments — masked key id only, fetched from the non-secret status
   * endpoint. Secrets never leave the server. */
  const [merchantLabel, setMerchantLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!isProviderMode) return;
    let alive = true;
    fetch("/api/psp/status", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          data: {
            provider?: string | null;
            env?: string | null;
            keyIdMasked?: string | null;
          } | null
        ) => {
          if (!alive || !data?.provider) return;
          const who = `${data.provider}${data.env ? ` ${data.env}` : ""}`;
          setMerchantLabel(data.keyIdMasked ? `${who} · ${data.keyIdMasked}` : who);
        }
      )
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isProviderMode, queueId]);
  const online = useOnline();
  const showOfflineCache = !online || connection !== "live";

  const ariaStatus = complete
    ? complete === "celebrate"
      ? `All payments complete. ${formatINR(state.collectedPaise)} collected. Copy or print the receipt below.`
      : "Collection cancelled."
    : displayOrder && PAYABLE.includes(displayOrder.status)
      ? `Payment ${displayOrder.seq} of ${state.queue.totalCount}. Amount ${formatINR(displayOrder.amountPaise)}. Waiting for provider confirmation.`
      : "";

  /* Screen-reader announcement when an order reaches a TERMINAL state
   * (paid/skipped/...) — the visual swipe alone is silent to AT users. */
  const paidAnnounce = useMemo(() => {
    const justSettled = state.orders.filter(
      (o) => TERMINAL.includes(o.status) && !handledRef.current.has(o.orderId) && o.status === "paid"
    );
    const latest = justSettled[justSettled.length - 1];
    if (!latest) return null;
    return `Payment ${latest.seq} of ${state.queue.totalCount} verified — ${formatINR(latest.amountPaise)} received.${
      state.current ? " Next QR shown." : " All payments complete."
    }`;
  }, [state]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="pm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Verified sequential payment collection"
    >
      <div className="pm-backdrop" onClick={onClose} aria-hidden="true" />

      {complete === "celebrate" && (
        <div className="pm-confetti" aria-hidden="true">
          {confettiPieces.map((piece) => (
            <span
              key={piece.id}
              style={
                {
                  left: piece.left,
                  width: piece.size,
                  height: piece.round ? piece.size : Math.round(piece.size * 0.45),
                  background: piece.color,
                  borderRadius: piece.round ? "999px" : "2px",
                  animationDelay: piece.delay,
                  animationDuration: piece.duration,
                  "--drift": piece.drift,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}

      <div ref={panelRef} className="pm-panel pv-panel">
        <span className="pv-handle" aria-hidden="true" />
        <header className="pm-header">
          <div>
            <span className="pm-eyebrow">
              Verified collection · {state.queue.payeeName}
            </span>
            <strong className="pm-total">{formatINR(state.queue.totalPaise)}</strong>
          </div>
          <div className="pv-header-badges">
            {isDemo && (
              <span className="pv-demo-badge" title="No payment provider is connected. Advances are simulated and clearly labeled.">
                <TriangleAlert size={11} aria-hidden="true" /> DEMO
              </span>
            )}
            {isRzpTest && (
              <span className="pv-mode-badge pv-mode-test" title="Real Razorpay API (test keys). Test QRs cannot be scanned by UPI apps — use the signed webhook test below to exercise the pipeline.">
                Razorpay TEST
              </span>
            )}
            {isRzpLive && (
              <span className="pv-mode-badge pv-mode-live" title="Real Razorpay account (live keys). Scanning this QR moves real money — verified via signed webhooks and the provider API.">
                Razorpay LIVE
              </span>
            )}
            {isPhonepeTest && (
              <span className="pv-mode-badge pv-mode-test" title="Real PhonePe Payment Gateway API (UAT credentials). Payment pages are initiated through PhonePe's Pay API; the server verifies via PhonePe's status API. UAT carries no real money.">
                <PhonePeIcon className="size-3" aria-hidden="true" /> PhonePe UAT
              </span>
            )}
            {isPhonepeLive && (
              <span className="pv-mode-badge pv-mode-live" title="Real PhonePe account (production). Payments happen on PhonePe's hosted page and move real money — verified via signed callback / status API.">
                <PhonePeIcon className="size-3" aria-hidden="true" /> PhonePe LIVE
              </span>
            )}
            {isPaytmTest && (
              <span className="pv-mode-badge pv-mode-test" title="Real Paytm Dynamic QR API (staging credentials). QRs are created through Paytm's API; the server verifies via Paytm's status API. Staging carries no real money.">
                <PaytmIcon className="size-3" aria-hidden="true" /> Paytm STAGING
              </span>
            )}
            {isPaytmLive && (
              <span className="pv-mode-badge pv-mode-live" title="Real Paytm account (production). Scanning this QR moves real money into your Paytm merchant account — verified via checksum-verified callback / status API.">
                <PaytmIcon className="size-3" aria-hidden="true" /> Paytm LIVE
              </span>
            )}
            {state.mode === "live" && (
              <span className="pv-mode-badge pv-mode-live" title="A live PSP webhook is configured via environment.">
                PSP LIVE
              </span>
            )}
            <span
              className={`pv-conn pv-conn-${connection}`}
              title="Real-time connection to the payment server"
            >
              <RadioTower size={11} aria-hidden="true" /> {connLabel}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="pm-close"
              onClick={onClose}
              aria-label="Close collection screen"
            >
              <X size={18} aria-hidden="true" />
            </Button>
          </div>
        </header>

        <div className="pm-progress-row">
          <span className="pm-collected">
            <Banknote size={14} aria-hidden="true" />
            {formatINR(state.collectedPaise)} collected
          </span>
          <span className="pm-count">
            {state.paidCount} of {state.queue.totalCount} paid
          </span>
        </div>
        <div
          className="pm-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={state.queue.totalCount}
          aria-valuenow={state.paidCount}
          aria-label="Payments verified"
        >
          <div className="pm-progress-fill" style={{ width: `${paidProgress}%` }} />
        </div>

        {showOfflineCache && (
          <OfflineBanner
            variant="inline"
            message={
              !online
                ? "Offline — showing last saved state. Payments can only complete when you are back online."
                : "Reconnecting — showing last saved state. It refreshes automatically."
            }
          />
        )}

        {notices.length > 0 && (
          <div className="pv-notices" role="alert">
            {notices.map((notice) => {
              const critical = notice.kind === "amount_mismatch" || notice.kind === "already_paid";
              return (
                <p
                  key={notice.id}
                  className={`pv-notice pv-notice-${notice.kind}${critical ? " pv-notice-critical" : ""}`}
                  aria-live={critical ? "assertive" : "polite"}
                >
                  <NoticeIcon kind={notice.kind} />
                  {notice.message}
                </p>
              );
            })}
          </div>
        )}

        {!complete ? (
          <>
            <div className="pm-stage pv-stage">
              <AnimatePresence initial={false} onExitComplete={handleExitComplete}>
                {displayOrder && (
                  <motion.div
                    key={displayOrder.orderId}
                    className="pm-card pv-current-card"
                    initial={reduce ? { opacity: 0 } : { x: 460, opacity: 0, scale: 0.94 }}
                    animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1, scale: 1 }}
                    exit={
                      reduce
                        ? { opacity: 0, transition: { duration: 0.16 } }
                        : { x: -470, opacity: 0, rotate: -6, transition: { duration: 0.4, ease: "easeIn" } }
                    }
                    transition={reduce ? { duration: 0.16 } : { type: "spring", stiffness: 300, damping: 27 }}
                  >
                    <div className="pm-chip-row">
                      <span className="pm-chip">
                        Payment {displayOrder.seq} of {state.queue.totalCount}
                      </span>
                      {state.queue.uniqueAmounts && (
                        <span className="pm-chip pm-chip-unique" title="Anti-scam mode: every QR on this bill has a different amount — one payment proof can never cover two codes.">
                          <ShieldCheck size={11} aria-hidden="true" /> Unique amount
                        </span>
                      )}
                    </div>
                    <h3 className="pm-amount">{formatINR(displayOrder.amountPaise)}</h3>
                    <div className="pm-qr-wrap">
                      {isPhonepeMode && displayOrder.paymentPageUrl ? (
                        <PhonePePageCard url={displayOrder.paymentPageUrl} />
                      ) : (
                        <QrImage
                          order={displayOrder}
                          cache={qrCache.current}
                          providerKind={qrKind}
                          alt={`Payment ${displayOrder.seq} of ${state.queue.totalCount}: ${formatINR(displayOrder.amountPaise)} to ${state.queue.payeeName}`}
                        />
                      )}
                    </div>
                    <p className="pv-order-ref" aria-label="Order reference">
                      Ref {displayOrder.orderId}
                    </p>
                    <div className="pm-payee">
                      <strong>{state.queue.payeeName}</strong>
                      <span>{state.queue.upiId}</span>
                    </div>
                    {state.queue.note && <p className="pm-note">{state.queue.note}</p>}

                    {stampFor === displayOrder.orderId && TERMINAL.includes(displayOrder.status) && (
                      <motion.div
                        className={`pm-stamp pm-stamp-left ${STAMP_TONE[displayOrder.status] ?? ""}`}
                        initial={{ opacity: 0, scale: 1.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.18 }}
                        aria-hidden="true"
                      >
                        <Check size={20} strokeWidth={3.2} /> {STAMP_LABEL[displayOrder.status]}
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {current ? (
              <>
                <div className="pv-waiting" role="status">
                  <span className="pv-waiting-dot" aria-hidden="true" />
                  <span>
                    Waiting for payment confirmation
                    <span className="pv-waiting-sub">
                      {isDemo
                        ? " — no PSP is connected, use the demo console below."
                        : isRzpTest
                          ? " — real Razorpay API (test keys); scan does nothing on test QRs, use the signed test below."
                          : isRzpLive
                            ? " — REAL payments: this QR is served by Razorpay; the next QR appears the moment Razorpay confirms."
                            : isPhonepeMode
                              ? isPhonepeLive
                                ? " — REAL payments on PhonePe's hosted page; the next QR appears the moment PhonePe's status API confirms."
                                : " — real PhonePe API (UAT): payment page is live, but no real money moves."
                              : isPaytmMode
                                ? isPaytmLive
                                  ? " — REAL payments: this dynamic QR is served by Paytm; the next QR appears the moment Paytm confirms."
                                  : " — real Paytm API (staging): dynamic QR is live, but no real money moves."
                                : " — the next QR appears automatically once the provider confirms."}
                    </span>
                  </span>
                </div>
                <div className="pv-meta-row">
                  <span
                    className={`pv-expiry ${expiresInMs < 60_000 ? "pv-expiry-low" : ""}`}
                  >
                    <Clock size={11} aria-hidden="true" />
                    QR expires in {formatCountdown(expiresInMs)}
                  </span>
                  {nextPayable && (
                    <span
                      className="pv-next-hint"
                      title={
                        isProviderMode
                          ? "Provisioned on demand, one order at a time"
                          : "Prefetched in the background — displayed only after this one is paid"
                      }
                    >
                      Next: {formatINR(nextPayable.amountPaise)}
                      {!isProviderMode && " · prefetched"}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="pv-waiting" role="status">
                <span className="pv-waiting-dot" aria-hidden="true" />
                <span>Settling the queue…</span>
              </div>
            )}

            {isProviderMode && current && (
              <div className="pv-liveverify">
                <div className="pv-liveverify-head">
                  <span className="pv-liveverify-pulse" aria-hidden="true" />
                  <strong>Live verification · {PROVIDER_LABEL[state.mode] ?? "provider"}</strong>
                </div>
                <p>
                  {merchantLabel
                    ? `Confirming against merchant ${merchantLabel} — signed provider events advance this queue automatically.`
                    : "Confirming with your connected provider — signed events advance this queue automatically."}
                </p>
                <div className="pv-liveverify-actions">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={verifyBusy || !current}
                    onClick={verifyNow}
                  >
                    <ShieldCheck size={14} aria-hidden="true" />
                    {verifyBusy ? "Asking the provider…" : "Check status now"}
                  </Button>
                </div>
                {verifyMsg && !shieldOpen && (
                  <p
                    className={verifyMsg.ok ? "pv-shield-verify-ok" : "pv-shield-verify-no"}
                    role="status"
                  >
                    {verifyMsg.text}
                  </p>
                )}
              </div>
            )}

            {isDemo && (
              <div className="pv-demo">
                <div className="pv-demo-head">
                  <TriangleAlert size={12} aria-hidden="true" />
                  <strong>Demo PSP console</strong>
                  <span>simulated provider events — same server pipeline as a real webhook</span>
                </div>
                <div className="pv-demo-grid pv-demo-primary">
                  <Button
                    type="button"
                    size="sm"
                    className="pv-demo-pay"
                    disabled={!current || simBusy !== null}
                    onClick={() => simulate("success")}
                  >
                    <BadgeCheck size={14} aria-hidden="true" />
                    {simBusy === "success" ? "Confirming…" : "Simulate scan & payment"}
                  </Button>
                </div>
                <button
                  type="button"
                  className="pv-staff-toggle pv-sim-toggle"
                  onClick={() => setSimTrainingOpen((open) => !open)}
                  aria-expanded={simTrainingOpen}
                >
                  <ShieldAlert size={12} aria-hidden="true" />
                  {simTrainingOpen ? "Hide fraud & edge training" : "Fraud & edge training"}
                </button>
                {simTrainingOpen && (
                  <div className="pv-demo-grid">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!current || simBusy !== null}
                      onClick={() => simulate("declined")}
                    >
                      {simBusy === "declined" ? "Sending…" : "Simulate declined"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!current || simBusy !== null}
                      onClick={() => simulate("wrong_amount")}
                    >
                      {simBusy === "wrong_amount" ? "Sending…" : "Wrong amount"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!current || simBusy !== null}
                      onClick={() => simulate("duplicate_success")}
                    >
                      {simBusy === "duplicate_success" ? "Replaying…" : "Duplicate success"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="pv-demo-scam"
                      disabled={!current || simBusy !== null}
                      title="The classic scam: shows the previous payment's proof again for THIS QR. The Fraud Shield must block it."
                      onClick={() => simulate("replayed_proof")}
                    >
                      <ShieldAlert size={14} aria-hidden="true" />
                      {simBusy === "replayed_proof" ? "Attacking…" : "Reused payment proof"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {isRzpTest && (
              <div className="pv-demo pv-provider">
                <div className="pv-demo-head pv-provider-head">
                  <ShieldCheck size={12} aria-hidden="true" />
                  <strong>Real Razorpay · test mode</strong>
                  <span>QRs are created live through the Razorpay API — but test QRs cannot be scanned by UPI apps.</span>
                </div>
                <p className="pv-provider-note">
                  To exercise the full pipeline before going live, the button below builds a{" "}
                  <code>qr_code.credited</code> event shaped exactly like Razorpay’s documented webhook,
                  signs it with your webhook secret, and delivers it to the real webhook endpoint —
                  genuine signature verification, deduplication and processing. The synthetic payment
                  is always labeled <code>pay_synthtest_…</code> and never presented as real money.
                </p>
                <div className="pv-demo-grid">
                  <Button
                    type="button"
                    size="sm"
                    className="pv-demo-pay"
                    disabled={!current?.providerQrId || webhookTestBusy}
                    onClick={sendWebhookTest}
                  >
                    <BadgeCheck size={14} aria-hidden="true" />
                    {webhookTestBusy ? "Delivering…" : "Send signed test webhook"}
                  </Button>
                </div>
                {!current?.providerQrId && !current?.providerQrError && (
                  <p className="pv-provider-wait">Waiting for the provider QR to be provisioned…</p>
                )}
              </div>
            )}

            {isRzpLive && (
              <div className="pv-demo pv-provider pv-provider-live">
                <div className="pv-demo-head pv-provider-head">
                  <ShieldCheck size={12} aria-hidden="true" />
                  <strong>Real Razorpay · live payments</strong>
                  <span>scanning this QR moves real money into your Razorpay account</span>
                </div>
                <p className="pv-provider-note">
                  Nothing to simulate here. The queue advances only when Razorpay itself confirms a
                  captured payment — via its signed webhook, or (if webhooks can’t reach this
                  deployment) by polling Razorpay’s payments API for this QR.
                </p>
              </div>
            )}

            {isPhonepeTest && (
              <div className="pv-demo pv-provider">
                <div className="pv-demo-head pv-provider-head">
                  <ShieldCheck size={12} aria-hidden="true" />
                  <strong>Real PhonePe · UAT</strong>
                  <span>payment pages are initiated live through PhonePe’s Pay API — UAT carries no real money</span>
                </div>
                <p className="pv-provider-note">
                  The customer pays on PhonePe’s own hosted page (opened via the button above — no
                  QR exists for this flow). The server verifies every payment through PhonePe’s
                  Check Payment Status API; nothing is simulated in PSP modes.
                </p>
              </div>
            )}

            {isPhonepeLive && (
              <div className="pv-demo pv-provider pv-provider-live">
                <div className="pv-demo-head pv-provider-head">
                  <ShieldCheck size={12} aria-hidden="true" />
                  <strong>Real PhonePe · live payments</strong>
                  <span>payments happen on PhonePe’s hosted page and move real money</span>
                </div>
                <p className="pv-provider-note">
                  Nothing to simulate here. The queue advances only when PhonePe itself confirms the
                  payment — via its signed callback (X-VERIFY), or (if callbacks can’t reach this
                  deployment) by polling PhonePe’s status API for this order.
                </p>
              </div>
            )}

            {isPaytmTest && (
              <div className="pv-demo pv-provider">
                <div className="pv-demo-head pv-provider-head">
                  <ShieldCheck size={12} aria-hidden="true" />
                  <strong>Real Paytm · staging</strong>
                  <span>dynamic QRs are created live through Paytm’s Dynamic QR API — staging carries no real money</span>
                </div>
                <p className="pv-provider-note">
                  This QR is Paytm’s own dynamic QR (bound to your MID and this exact amount) — it
                  pays into your Paytm account, never into the raw UPI ID. The server verifies every
                  payment through Paytm’s Transaction Status API; nothing is simulated in PSP modes.
                </p>
              </div>
            )}

            {isPaytmLive && (
              <div className="pv-demo pv-provider pv-provider-live">
                <div className="pv-demo-head pv-provider-head">
                  <ShieldCheck size={12} aria-hidden="true" />
                  <strong>Real Paytm · live payments</strong>
                  <span>scanning this QR moves real money into your Paytm merchant account</span>
                </div>
                <p className="pv-provider-note">
                  Nothing to simulate here. The queue advances only when Paytm itself confirms the
                  payment — via its checksum-verified callback, or (if callbacks can’t reach this
                  deployment) by polling Paytm’s Transaction Status API for this order.
                </p>
              </div>
            )}

            <div className="pv-shield-area">
              <button
                type="button"
                className="pv-shield-toggle"
                onClick={() => setShieldOpen((open) => !open)}
                aria-expanded={shieldOpen}
              >
                <ShieldCheck size={12} aria-hidden="true" />
                Fraud Shield
                <span className="pv-shield-sub">
                  {security?.serverVerified === false
                    ? "screenshots can't pay · demo events are labeled"
                    : "screenshots can't pay · provider-verified only"}
                </span>
                {security && security.alerts.length > 0 && (
                  <span
                    className="pv-shield-count"
                    title={`${security.alerts.length} fraud signal${security.alerts.length === 1 ? "" : "s"} recorded in this session`}
                  >
                    {security.alerts.length}
                  </span>
                )}
              </button>
              {shieldOpen && (
                <div className="pv-shield">
                  <ul className="pv-shield-guarantees">
                    {(security?.guarantees ?? []).map((g) => (
                      <li key={g.key}>
                        <ShieldCheck size={11} aria-hidden="true" />
                        {g.text}
                      </li>
                    ))}
                    {security === null &&
                      FALLBACK_GUARANTEES.map((text) => (
                        <li key={text}>
                          <ShieldCheck size={11} aria-hidden="true" />
                          {text}
                        </li>
                      ))}
                  </ul>
                  <div className="pv-shield-verify">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={verifyBusy}
                      onClick={verifyNow}
                    >
                      <ShieldCheck size={14} aria-hidden="true" />
                      {verifyBusy ? "Asking the provider…" : "Verify payment now"}
                    </Button>
                    {verifyMsg && (
                      <p
                        className={
                          verifyMsg.ok ? "pv-shield-verify-ok" : "pv-shield-verify-no"
                        }
                        role="status"
                      >
                        {verifyMsg.text}
                      </p>
                    )}
                    <p className="pv-shield-note">
                      Customer says “payment ho gaya”? This button asks the payment
                      provider directly. Trust only the VERIFIED stamp — never a
                      screenshot, SMS, or a forwarded “success” screen.
                    </p>
                  </div>
                  {security && security.alerts.length > 0 && (
                    <ul className="pv-shield-alerts" aria-live="polite">
                      {security.alerts.map((alert) => (
                        <li
                          key={alert.id}
                          className={`pv-shield-alert pv-shield-alert-${alert.severity}`}
                        >
                          <span className="pv-shield-alert-top">
                            <ShieldAlert size={12} aria-hidden="true" />
                            <strong>
                              {alert.type.replaceAll("_", " ").toLowerCase()}
                              {alert.count > 1 && ` ×${alert.count}`}
                            </strong>
                            <time dateTime={alert.lastSeenAt}>{fmtClock(alert.lastSeenAt)}</time>
                          </span>
                          <span className="pv-shield-alert-msg">{alert.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="pv-staff-area">
              <button
                type="button"
                className="pv-staff-toggle"
                onClick={() => setStaffOpen((open) => !open)}
                aria-expanded={staffOpen}
              >
                <Shield size={12} aria-hidden="true" /> Staff controls
              </button>
              {staffOpen && (
                <div className="pv-staff">
                  <Input
                    value={staffReason}
                    onChange={(event) => setStaffReason(event.target.value)}
                    placeholder="Reason (optional, audit-logged)"
                    maxLength={120}
                    aria-label="Override reason"
                  />
                  <div className="pv-staff-actions">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!current || staffBusy}
                      onClick={() => (armed === "skip" ? runOverride("skip") : setArmed("skip"))}
                    >
                      {armed === "skip" ? "Confirm skip?" : "Skip current QR"}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={staffBusy}
                      onClick={() => (armed === "cancel" ? runOverride("cancel") : setArmed("cancel"))}
                    >
                      {armed === "cancel" ? "Confirm cancel?" : "Cancel session"}
                    </Button>
                  </div>
                  <p className="pv-staff-note">
                    Skipped QRs are marked “skipped”, never “paid”. Paid QRs can’t
                    collect again — repeat provider events are rejected server-side.
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <motion.div
            className="pm-complete"
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
          >
            {complete === "celebrate" ? (
              <>
                <svg viewBox="0 0 72 72" className="pm-check" aria-hidden="true">
                  <circle className="pm-check-circle" cx="36" cy="36" r="33" />
                  <path className="pm-check-mark" d="M22.5 37.5 32 47 50.5 27.5" />
                </svg>
                <h3>All payments complete</h3>
                <p>
                  <strong>{formatINR(state.collectedPaise)}</strong> verified received in{" "}
                  {state.paidCount} {state.paidCount === 1 ? "payment" : "payments"} to{" "}
                  {state.queue.payeeName}.
                  {state.orders.some((o) => ["skipped", "expired", "failed", "cancelled"].includes(o.status)) && (
                    <>
                      {" "}
                      ({state.orders.filter((o) => o.status === "skipped").length} skipped,{" "}
                      {state.orders.filter((o) => ["expired", "failed", "cancelled"].includes(o.status)).length}{" "}
                      closed unpaid — see history.)
                    </>
                  )}
                </p>
              </>
            ) : (
              <>
                <svg viewBox="0 0 72 72" className="pm-check pv-check-muted" aria-hidden="true">
                  <circle className="pm-check-circle" cx="36" cy="36" r="33" />
                  <path className="pm-check-mark" d="M26 26 46 46 M46 26 26 46" />
                </svg>
                <h3>Collection cancelled</h3>
                <p>
                  The session was cancelled by staff. Uncollected QRs were closed and
                  can no longer be paid.
                </p>
              </>
            )}
            <div className="pm-complete-actions">
              <Button type="button" variant="outline" onClick={onClose}>
                View all QR codes
              </Button>
              <Button type="button" onClick={onNewCollection}>
                Start new collection
              </Button>
            </div>
            <div className="pm-complete-actions">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyReceipt}
                aria-label="Copy collection receipt as text"
              >
                {copiedReceipt ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copiedReceipt ? "Receipt copied" : "Copy receipt (text)"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={printReceipt}
                aria-label="Print a reconciliation sheet"
              >
                <Printer size={14} aria-hidden="true" />
                Print reconciliation sheet
              </Button>
            </div>
            <details
              className="pv-receipt-box"
              open={receiptOpen}
              onToggle={(event) => setReceiptOpen(event.currentTarget.open)}
            >
              <summary>Receipt preview</summary>
              <pre>{receiptText}</pre>
            </details>
          </motion.div>
        )}

        <div className="pv-history-area">
          <button
            type="button"
            className="pv-history-toggle"
            onClick={() => setHistoryOpen((open) => !open)}
            aria-expanded={historyOpen}
          >
            <History size={12} aria-hidden="true" /> {historyOpen ? "Hide" : "Show"} payment
            history ({state.orders.length})
          </button>
          {historyOpen && (
            <ol className="pv-history">
              {state.orders.map((order) => (
                <li key={order.orderId} className="pv-history-row">
                  <span className="pv-history-seq">#{order.seq}</span>
                  <span className="pv-history-amount">{formatINR(order.amountPaise)}</span>
                  <span className="pv-history-ref">{order.orderId}</span>
                  <span className={`pv-chip ${STATUS_CHIP[order.status] ?? ""}`}>
                    {order.status}
                  </span>
                  {order.status === "paid" && order.paidAt && (
                    <time className="pv-history-time">
                      {new Date(order.paidAt).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  )}
                  {order.status === "paid" && order.providerRef && (
                    <span
                      className="pv-history-utr"
                      title="Provider transaction reference — cross-check this in your PSP/bank dashboard"
                    >
                      ref {order.providerRef}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {ariaStatus}
        </p>
        {paidAnnounce && (
          <p role="status" aria-live="assertive" className="sr-only">
            {paidAnnounce}
          </p>
        )}

        <p className="pv-footer-note">
          <ShieldCheck size={11} aria-hidden="true" />
          Server-verified queue · every advance requires a provider-confirmed event ·
          one payment = one QR · screenshots can never complete a QR
          {isDemo
            ? " · demo: events are simulated"
            : isRzpLive
              ? " · Razorpay live: verified via signed webhook / provider API"
              : isRzpTest
                ? " · Razorpay test: real API, synthetic payments labeled"
                : isPhonepeLive
                  ? " · PhonePe live: verified via signed callback / status API"
                  : isPhonepeTest
                    ? " · PhonePe UAT: real API, no real money"
                    : isPaytmLive
                      ? " · Paytm live: verified via checksummed callback / status API"
                      : isPaytmTest
                        ? " · Paytm staging: real API, no real money"
                        : ""}
        </p>
      </div>
    </div>,
    document.body
  );
}
