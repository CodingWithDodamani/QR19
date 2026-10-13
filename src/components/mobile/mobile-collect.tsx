"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { motion } from "framer-motion";
import { ArrowRight, BadgeCheck, Check, ChevronLeft, ChevronRight, Download, Expand, LoaderCircle, LockKeyhole, Share2, ShieldCheck, X } from "lucide-react";

import { OfflineBanner } from "@/components/offline/offline-banner";
import { VerifiedPaymentMode } from "@/components/qr19/verified-payment-mode";
import { useOfflineQueueSync } from "@/hooks/use-offline-queue-sync";
import { useOnline } from "@/hooks/use-online";
import {
  enqueueDraft,
  loadFormDraft,
  removeDraft,
  saveFormDraft,
} from "@/lib/offline/outbox";
import { loadMerchantProfile, pushNotification } from "@/lib/offline/notifications";
import type { QueueState } from "@/lib/payment/types";
import {
  buildUpiLink,
  formatINR,
  parseAmountToPaise,
  sanitizeAmountInput,
  splitIntoPayments,
  splitIntoUniquePayments,
} from "@/lib/upi";

import { tapTick } from "./mobile-shell";

interface MobilePayment {
  amount: number;
  link: string;
  image: string;
}

const QR_OPTIONS = {
  width: 640,
  margin: 3,
  errorCorrectionLevel: "M" as const,
  color: { dark: "#182621", light: "#ffffff" },
};

/**
 * Collect screen: EasyPay-style form → swipeable QR cards → verified
 * collection overlay. Same pipeline as before (on-device split, idempotent
 * queue create, server-verified advance), offline-capable.
 */
export function CollectScreen() {
  const online = useOnline();
  const [upiId, setUpiId] = useState("");
  const [accountName, setAccountName] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [uniqueMode, setUniqueMode] = useState(false);
  const [payments, setPayments] = useState<MobilePayment[] | null>(null);
  const [total, setTotal] = useState(0);
  const [sessionKey, setSessionKey] = useState("");
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectError, setCollectError] = useState("");
  const [shared, setShared] = useState(false);
  const [activeQueue, setActiveQueue] = useState<{ id: string; state: QueueState } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [verifyLabel, setVerifyLabel] = useState<string | null>(null);
  const { drafts, pendingCount, syncing, syncNow, refresh } = useOfflineQueueSync();

  /* QR strip navigation: active index + smooth paging + mouse drag. */
  const stripRef = useRef<HTMLDivElement>(null);
  const [qrIndex, setQrIndex] = useState(0);
  const dragRef = useRef<{ startX: number; startLeft: number } | null>(null);
  const draggedRef = useRef(false);

  function scrollStripTo(index: number) {
    const strip = stripRef.current;
    const count = payments?.length ?? 0;
    if (!strip || count === 0) return;
    const clamped = Math.max(0, Math.min(count - 1, index));
    const child = strip.children[clamped] as HTMLElement | undefined;
    if (!child) return;
    tapTick();
    const stripRect = strip.getBoundingClientRect();
    const childRect = child.getBoundingClientRect();
    strip.scrollTo({
      left: strip.scrollLeft + (childRect.left - stripRect.left) - (strip.clientWidth - childRect.width) / 2,
      behavior: "smooth",
    });
    setQrIndex(clamped);
  }

  function handleStripScroll() {
    const strip = stripRef.current;
    if (!strip || !payments || payments.length < 2) return;
    const center = strip.getBoundingClientRect().left + strip.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    Array.from(strip.children).forEach((child, i) => {
      const rect = (child as HTMLElement).getBoundingClientRect();
      const dist = Math.abs(rect.left + rect.width / 2 - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setQrIndex((prev) => (prev === best ? prev : best));
  }

  function handleStripPointerDown(event: React.PointerEvent) {
    if (event.pointerType !== "mouse") return;
    const strip = stripRef.current;
    if (!strip) return;
    draggedRef.current = false;
    dragRef.current = { startX: event.clientX, startLeft: strip.scrollLeft };
  }

  function handleStripPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    const strip = stripRef.current;
    if (!drag || !strip || event.pointerType !== "mouse") return;
    const dx = event.clientX - drag.startX;
    if (Math.abs(dx) > 6) draggedRef.current = true;
    if (draggedRef.current) strip.scrollLeft = drag.startLeft - dx;
  }

  function endStripDrag() {
    dragRef.current = null;
  }

  function swallowDragClick(event: React.SyntheticEvent) {
    if (draggedRef.current) {
      event.preventDefault();
      event.stopPropagation();
      draggedRef.current = false;
    }
  }

  useEffect(() => {
    const saved = loadFormDraft();
    const profile = loadMerchantProfile();
    if (saved) {
      if (saved.upiId) setUpiId(saved.upiId);
      else if (profile?.upiId) setUpiId(profile.upiId);
      if (saved.payeeName) setAccountName(saved.payeeName);
      else if (profile?.name) setAccountName(profile.name);
      if (saved.amount) setAmount(saved.amount);
      if (saved.note) setNote(saved.note);
      if (typeof saved.uniqueMode === "boolean") setUniqueMode(saved.uniqueMode);
    } else if (profile) {
      if (profile.upiId) setUpiId(profile.upiId);
      if (profile.name) setAccountName(profile.name);
    }
  }, []);

  useEffect(() => {
    saveFormDraft({ upiId, payeeName: accountName, amount, note, uniqueMode });
  }, [upiId, accountName, amount, note, uniqueMode]);

  useEffect(() => {
    let alive = true;
    fetch("/api/psp/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { configured?: boolean; provider?: string | null; env?: string | null; enabled?: boolean; keyIdMasked?: string | null } | null) => {
        if (!alive) return;
        if (data?.configured && data?.enabled && data?.provider) {
          const who = `${data.provider}${data.env ? ` ${data.env}` : ""}${data.keyIdMasked ? ` · ${data.keyIdMasked}` : ""}`;
          setVerifyLabel(`Auto-verified by ${who}`);
        } else {
          setVerifyLabel("Demo mode — advances are simulated, no real money");
        }
      })
      .catch(() => {
        if (alive) setVerifyLabel("Demo mode — advances are simulated, no real money");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (zoom === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoom(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [zoom]);

  let previewPayments: number[] = [];
  let uniquePreviewError = "";
  try {
    const previewTotal = parseAmountToPaise(amount);
    if (uniqueMode) {
      try {
        previewPayments = splitIntoUniquePayments(previewTotal);
      } catch (err) {
        uniquePreviewError = err instanceof Error ? err.message : "Unique amounts are not possible for this total.";
        previewPayments = splitIntoPayments(previewTotal);
      }
    } else {
      previewPayments = splitIntoPayments(previewTotal);
    }
  } catch {
    // blank / invalid input — no preview yet
  }

  async function handleGenerate(event: React.FormEvent) {
    event.preventDefault();
    tapTick();
    setError("");
    setPayments(null);
    setGenerating(true);
    try {
      if (!/^[a-zA-Z0-9._-]{2,60}@[a-zA-Z0-9.-]{2,60}$/.test(upiId.trim())) {
        throw new Error("Enter a valid UPI ID, such as name@okaxis.");
      }
      if (!accountName.trim()) throw new Error("Enter the account holder's name.");
      const totalPaise = parseAmountToPaise(amount);
      const txnRef = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
      const split = uniqueMode ? splitIntoUniquePayments(totalPaise) : splitIntoPayments(totalPaise);
      const made = await Promise.all(
        split.map(async (paise, index) => {
          const link = buildUpiLink(upiId.trim(), accountName.trim(), paise, note.trim(), `${txnRef}${index + 1}`);
          const image = await QRCode.toDataURL(link, QR_OPTIONS);
          return { amount: paise, link, image };
        })
      );
      setPayments(made);
      setTotal(totalPaise);
      setSessionKey(crypto.randomUUID());
      setQrIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate QR codes.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleStartCollecting() {
    if (!payments || collecting) return;
    tapTick();
    setCollecting(true);
    setCollectError("");
    const payload = {
      upiId: upiId.trim(),
      payeeName: accountName.trim(),
      note: note.trim(),
      amountsPaise: payments.map((p) => p.amount),
      uniqueAmounts: uniqueMode,
      expiresInSecs: 900,
      idempotencyKey: sessionKey,
    };
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      enqueueDraft(payload);
      refresh();
      pushNotification({
        kind: "queued",
        title: "Collection queued offline",
        body: `${payload.payeeName} · ${formatINR(total)} — will sync when you reconnect.`,
      });
      setCollectError("You are offline — queued on this device, syncs when you reconnect.");
      setCollecting(false);
      return;
    }
    try {
      const response = await fetch("/api/payment-queues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { error?: string; queueId?: string; state?: QueueState };
      if (!response.ok || !data.queueId || !data.state) {
        throw new Error(data.error ?? "Could not start the collection session.");
      }
      setActiveQueue({ id: data.queueId, state: data.state });
    } catch (err) {
      const offline = err instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
      if (offline) {
        enqueueDraft(payload);
        refresh();
        pushNotification({
          kind: "queued",
          title: "Collection queued offline",
          body: `${payload.payeeName} · ${formatINR(total)} — will sync when you reconnect.`,
        });
        setCollectError("No connection — queued on this device and will sync automatically.");
      } else {
        setCollectError(err instanceof Error ? err.message : "Could not start the collection session.");
      }
    } finally {
      setCollecting(false);
    }
  }

  async function handleRetrySync() {
    tapTick();
    const synced = await syncNow().catch(() => undefined);
    refresh();
    if (synced && synced.length > 0) {
      pushNotification({
        kind: "synced",
        title: synced.length === 1 ? "Queued collection synced" : `${synced.length} queued collections synced`,
        body: "Server-verified collection is now available.",
      });
      try {
        const response = await fetch(`/api/payment-queues/${synced[0]}`, { cache: "no-store" });
        if (response.ok) {
          const state = (await response.json()) as QueueState;
          setActiveQueue({ id: synced[0], state });
          setCollectError("");
        }
      } catch {
        // synced but snapshot fetch failed — outbox is already clear
      }
    }
  }

  async function handleShare() {
    if (!payments) return;
    tapTick();
    const text = `Pay ${accountName.trim()} ${formatINR(total)} via UPI — ${payments.length} QR code${payments.length > 1 ? "s" : ""} (${payments.map((p) => formatINR(p.amount)).join(" + ")}). UPI ID: ${upiId.trim()}`;
    setShared(false);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `Pay ${accountName.trim()}`, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setShared(true);
      window.setTimeout(() => setShared(false), 2000);
    } catch {
      // share cancelled — nothing to do
    }
  }

  return (
    <div className="ep-collect">
      <header className="ep-pagehead">
        <h1>New collection</h1>
        <p>Split a bill into ₹1,999-or-less QRs</p>
      </header>

      <OfflineBanner
        pendingCount={pendingCount}
        syncing={syncing}
        onRetry={handleRetrySync}
      />

      {!payments ? (
        <form className="ep-card" onSubmit={handleGenerate}>
          <label className="ep-field">
            <span>Your UPI ID</span>
            <input
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="name@bank"
              maxLength={100}
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </label>
          <label className="ep-field">
            <span>Account holder name</span>
            <input
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="Full name"
              maxLength={100}
              autoComplete="name"
              required
            />
          </label>
          <label className="ep-field">
            <span>Full amount to collect</span>
            <span className="ep-amount">
              <span aria-hidden="true">₹</span>
              <input
                value={amount}
                onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))}
                placeholder="0.00"
                inputMode="decimal"
                maxLength={12}
                required
              />
            </span>
          </label>
          <div className="ep-chips" role="group" aria-label="Quick amounts">
            {["500", "1000", "1999", "5000"].map((quick) => (
              <button key={quick} type="button" className="ep-chip" onClick={() => { tapTick(); setAmount(quick); }}>
                ₹{quick}
              </button>
            ))}
          </div>
          {previewPayments.length > 0 ? (
            <p className="ep-preview" aria-live="polite">
              Splits into {previewPayments.length} QR{previewPayments.length > 1 ? "s" : ""}:{" "}
              {previewPayments.slice(0, 3).map((paise) => formatINR(paise)).join(" + ")}
              {previewPayments.length > 3 ? ` +${previewPayments.length - 3} more` : ""}
            </p>
          ) : null}
          {uniquePreviewError ? (
            <p className="ep-preview-warn" role="alert">{uniquePreviewError}</p>
          ) : null}
          <label className="ep-field">
            <span>Note <em>optional</em></span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Invoice 001"
              maxLength={80}
            />
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={uniqueMode}
            className={uniqueMode ? "ep-toggle ep-toggle-on" : "ep-toggle"}
            onClick={() => { tapTick(); setUniqueMode((v) => !v); }}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Unique amount per QR <em>anti-scam</em></span>
            <span className="ep-switch" aria-hidden="true" />
          </button>
          {error ? (
            <p className="ep-error" role="alert">{error}</p>
          ) : null}
          <button type="submit" className="ep-btn" disabled={generating}>
            {generating ? <LoaderCircle size={17} className="loading-icon" aria-hidden="true" /> : <span>Generate QR codes</span>}
            {!generating && <ArrowRight size={17} aria-hidden="true" />}
          </button>
          <p className="ep-privacy">
            <LockKeyhole size={12} aria-hidden="true" /> Details never leave this device until you start collecting.
          </p>
        </form>
      ) : (
        <section aria-live="polite">
          <motion.div
            className="ep-hero"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <p className="ep-hero-label">Total to collect</p>
            <p className="ep-hero-amount">{formatINR(total)}</p>
            <p className="ep-hero-sub">
              {payments.length} QR code{payments.length > 1 ? "s" : ""} · {accountName.trim()} · {upiId.trim()}
            </p>
            {uniqueMode ? (
              <span className="ep-tag">
                <ShieldCheck size={11} aria-hidden="true" /> All amounts different
              </span>
            ) : null}
          </motion.div>
          <div
            ref={stripRef}
            className="ep-qrstrip"
            role="list"
            aria-label="Generated QR codes. Activate a code to enlarge it."
            onScroll={handleStripScroll}
            onPointerDown={handleStripPointerDown}
            onPointerMove={handleStripPointerMove}
            onPointerUp={endStripDrag}
            onPointerLeave={endStripDrag}
            onPointerCancel={endStripDrag}
            onClickCapture={swallowDragClick}
          >
            {payments.map((payment, index) => (
              <motion.figure
                key={payment.link}
                className="ep-qrcard"
                role="listitem"
                initial={{ opacity: 0, y: 18, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.25, delay: Math.min(index, 5) * 0.06, ease: "easeOut" }}
              >
                <figcaption>
                  {index + 1} of {payments.length}
                </figcaption>
                <button
                  type="button"
                  className="ep-qrzoom"
                  onClick={() => { tapTick(); setZoom(index); }}
                  aria-label={`Enlarge QR code ${index + 1}, ${formatINR(payment.amount)}`}
                >
                  <img src={payment.image} alt={`Payment ${index + 1}: ${formatINR(payment.amount)}`} width={220} height={220} />
                  <span aria-hidden="true">Tap to enlarge</span>
                </button>
                <strong>{formatINR(payment.amount)}</strong>
                <a
                  className="ep-dl"
                  href={payment.image}
                  download={`qr19-payment-${index + 1}-${(payment.amount / 100).toFixed(2)}.png`}
                >
                  <Download size={13} aria-hidden="true" /> Save PNG
                </a>
              </motion.figure>
            ))}
          </div>
          {payments.length > 1 ? (
            <div className="ep-pager" role="group" aria-label="Browse QR codes">
              <button
                type="button"
                className="ep-pgbtn"
                disabled={qrIndex === 0}
                onClick={() => scrollStripTo(qrIndex - 1)}
                aria-label="Previous QR code"
              >
                <ChevronLeft size={17} aria-hidden="true" />
              </button>
              {payments.length <= 8 ? (
                <div className="ep-dots">
                  {payments.map((payment, i) => (
                    <button
                      key={payment.link}
                      type="button"
                      className={i === qrIndex ? "ep-dot ep-dot-on" : "ep-dot"}
                      onClick={() => scrollStripTo(i)}
                      aria-label={`Go to QR code ${i + 1} of ${payments.length}`}
                      aria-current={i === qrIndex || undefined}
                    />
                  ))}
                </div>
              ) : null}
              <span className="ep-pgcount" aria-live="polite">
                {qrIndex + 1} / {payments.length}
              </span>
              <button
                type="button"
                className="ep-pgbtn"
                disabled={qrIndex === payments.length - 1}
                onClick={() => scrollStripTo(qrIndex + 1)}
                aria-label="Next QR code"
              >
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {verifyLabel ? (
            <p className="ep-verifyline">
              <BadgeCheck size={14} aria-hidden="true" />
              {verifyLabel}
            </p>
          ) : null}
          {collectError ? (
            <p className="ep-error" role="alert">{collectError}</p>
          ) : null}
          <div className="ep-ctarow">
            <button type="button" className="ep-btn ep-btn-flex" onClick={handleStartCollecting} disabled={collecting}>
              {collecting ? <LoaderCircle size={17} className="loading-icon" aria-hidden="true" /> : null}
              {collecting ? "Opening…" : "Start collecting"}
            </button>
            <button type="button" className="ep-squarebtn" onClick={handleShare} aria-label="Share payment request">
              {shared ? <Check size={17} aria-hidden="true" /> : <Share2 size={17} aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="ep-squarebtn ep-squarebtn-text"
              onClick={() => {
                tapTick();
                setPayments(null);
                setCollectError("");
              }}
            >
              New
            </button>
          </div>
          {!online && drafts.length > 0 ? (
            <div className="ep-pending" aria-label="Pending offline collections">
              {drafts.slice(0, 3).map((draft) => (
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
          ) : null}
        </section>
      )}

      {activeQueue ? (
        <VerifiedPaymentMode
          queueId={activeQueue.id}
          initialState={activeQueue.state}
          onClose={() => setActiveQueue(null)}
          onNewCollection={() => {
            setActiveQueue(null);
            setPayments(null);
            setAmount("");
            setNote("");
          }}
        />
      ) : null}

      {zoom !== null && payments && payments[zoom] ? (
        <div className="ep-zoom" role="dialog" aria-modal="true" aria-label={`QR code enlarged, ${formatINR(payments[zoom].amount)}`}>
          <div className="ep-zoom-bg" onClick={() => setZoom(null)} aria-hidden="true" />
          <motion.div
            className="ep-sheet"
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <span className="ep-handle" aria-hidden="true" />
            <img
              src={payments[zoom].image}
              alt={`Payment ${zoom + 1} of ${payments.length}: ${formatINR(payments[zoom].amount)} to ${accountName.trim()}`}
              width={320}
              height={320}
            />
            <strong className="ep-zoom-amt">{formatINR(payments[zoom].amount)}</strong>
            <span className="ep-zoom-sub">
              Code {zoom + 1} of {payments.length} · {upiId.trim()}
            </span>
            <div className="ep-ctarow">
              <a
                className="ep-btn ep-btn-flex ep-dlbtn"
                href={payments[zoom].image}
                download={`qr19-payment-${zoom + 1}-${(payments[zoom].amount / 100).toFixed(2)}.png`}
              >
                <Download size={15} aria-hidden="true" /> Save PNG
              </a>
              <button type="button" className="ep-squarebtn" onClick={() => setZoom(null)} aria-label="Close enlarged QR">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </div>
  );
}
