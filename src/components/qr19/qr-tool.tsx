"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  ArrowRight,
  Check,
  Download,
  LoaderCircle,
  LockKeyhole,
  Printer,
  ScanLine,
  Share2,
  ShieldCheck,
} from "lucide-react";

import { VerifiedPaymentMode } from "@/components/qr19/verified-payment-mode";
import { OfflineBanner } from "@/components/offline/offline-banner";
import { useOfflineQueueSync } from "@/hooks/use-offline-queue-sync";
import {
  enqueueDraft,
  loadFormDraft,
  removeDraft,
  saveFormDraft,
} from "@/lib/offline/outbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { QrCode } from "lucide-react";
import {
  buildUpiLink,
  formatINR,
  parseAmountToPaise,
  sanitizeAmountInput,
  splitIntoPayments,
  splitIntoUniquePayments,
} from "@/lib/upi";
import type { QueueState } from "@/lib/payment/types";

interface GeneratedPayment {
  amount: number;
  link: string;
  image: string;
}

interface GeneratedResult {
  name: string;
  upi: string;
  total: number;
  note?: string;
  /** Anti-scam mode: every QR amount is different (≥ ₹1 apart). */
  uniqueAmounts: boolean;
  payments: GeneratedPayment[];
  /** Per-generation key: the verified queue endpoint is idempotent, so
   *  double-clicking “Start collecting” can never create two sessions. */
  sessionKey: string;
}

/**
 * The QR19 payment tool: form + live summary + generated QR codes.
 * Fully on-device — nothing is uploaded anywhere.
 */
export function QrTool() {
  const [upiId, setUpiId] = useState("");
  const [accountName, setAccountName] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectError, setCollectError] = useState("");
  const [activeQueue, setActiveQueue] = useState<{ id: string; state: QueueState } | null>(
    null
  );
  /** "idle" while the share button is normal, "done" right after a copy. */
  const [shared, setShared] = useState(false);
  /** Anti-scam toggle: every QR gets a different amount. */
  const [uniqueMode, setUniqueMode] = useState(false);
  const { drafts, pendingCount, syncing, syncNow, refresh } = useOfflineQueueSync();

  // Restore unsent merchant input after reload / offline (local only).
  useEffect(() => {
    const saved = loadFormDraft();
    if (saved) {
      if (saved.upiId) setUpiId(saved.upiId);
      if (saved.payeeName) setAccountName(saved.payeeName);
      if (saved.amount) setAmount(saved.amount);
      if (saved.note) setNote(saved.note);
      if (typeof saved.uniqueMode === "boolean") setUniqueMode(saved.uniqueMode);
    }
  }, []);

  // Persist form input locally so offline work is never lost.
  useEffect(() => {
    saveFormDraft({ upiId, payeeName: accountName, amount, note, uniqueMode });
  }, [upiId, accountName, amount, note, uniqueMode]);

  // Live preview of how the amount splits into QR-sized chunks (may be empty
  // while the typed amount is blank or invalid). In unique mode an
  // un-splittable total falls back to the standard preview with an honest
  // hint instead of silently pretending it worked.
  let previewPayments: number[] = [];
  let uniquePreviewError = "";
  try {
    const previewTotal = parseAmountToPaise(amount);
    if (uniqueMode) {
      try {
        previewPayments = splitIntoUniquePayments(previewTotal);
      } catch (err) {
        uniquePreviewError =
          err instanceof Error ? err.message : "Unique amounts are not possible for this total.";
        previewPayments = splitIntoPayments(previewTotal);
      }
    } else {
      previewPayments = splitIntoPayments(previewTotal);
    }
  } catch {}

  function clearFeedback(apply: () => void) {
    apply();
    setResult(null);
    setError("");
  }

  async function handleGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setLoading(true);

    try {
      if (!/^[a-zA-Z0-9._-]{2,60}@[a-zA-Z0-9.-]{2,60}$/.test(upiId.trim())) {
        throw new Error("Enter a valid UPI ID, such as yourname@okaxis.");
      }

      if (!accountName.trim()) {
        throw new Error("Enter the account holder’s name.");
      }

      const totalPaise = parseAmountToPaise(amount);
      const txnRef = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
      const splitFn = uniqueMode ? splitIntoUniquePayments : splitIntoPayments;

      const payments = await Promise.all(
        splitFn(totalPaise).map(async (paymentPaise, index) => {
          const link = buildUpiLink(
            upiId.trim(),
            accountName.trim(),
            paymentPaise,
            note.trim(),
            `${txnRef}${index + 1}`
          );
          const image = await QRCode.toDataURL(link, {
            width: 720,
            margin: 4,
            errorCorrectionLevel: "M",
            color: { dark: "#182621", light: "#ffffff" },
          });
          return { amount: paymentPaise, link, image };
        })
      );

      setResult({
        name: accountName.trim(),
        upi: upiId.trim(),
        total: totalPaise,
        note: note.trim() || undefined,
        uniqueAmounts: uniqueMode,
        payments,
        sessionKey: crypto.randomUUID(),
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not generate QR codes. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  /**
   * Start a server-verified collection: uploads the split to the backend,
   * which creates one persisted order (unique order ID + expiry) per QR and
   * returns the initial queue snapshot. From then on the display screen is
   * driven purely by server events — never by local taps.
   */
  async function handleStartCollecting() {
    if (!result || collecting) return;
    setCollecting(true);
    setCollectError("");

    const payload = {
      upiId: result.upi,
      payeeName: result.name,
      note: result.note ?? "",
      amountsPaise: result.payments.map((payment) => payment.amount),
      uniqueAmounts: result.uniqueAmounts,
      expiresInSecs: 900,
      idempotencyKey: result.sessionKey,
    };

    // Offline-first: queue locally when there is no connection. The same
    // idempotencyKey is replayed on reconnect, so sync can never duplicate.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      enqueueDraft(payload);
      refresh();
      setCollectError(
        "You are offline — this collection was queued on this device and will sync automatically when connectivity returns."
      );
      setCollecting(false);
      return;
    }

    try {
      const response = await fetch("/api/payment-queues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        error?: string;
        queueId?: string;
        state?: QueueState;
      };
      if (!response.ok || !data.queueId || !data.state) {
        throw new Error(data.error ?? "Could not start the collection session.");
      }
      setActiveQueue({ id: data.queueId, state: data.state });
    } catch (err) {
      const offline =
        err instanceof TypeError ||
        (typeof navigator !== "undefined" && navigator.onLine === false);
      if (offline) {
        enqueueDraft(payload);
        refresh();
        setCollectError(
          "Could not reach the server — queued on this device. It will sync automatically when you are back online."
        );
      } else {
        setCollectError(
          err instanceof Error
            ? err.message
            : "Could not start the collection session."
        );
      }
    } finally {
      setCollecting(false);
    }
  }

  async function handleRetrySync() {
    const synced = await syncNow().catch(() => undefined);
    if (synced && synced.length > 0) {
      try {
        const response = await fetch(`/api/payment-queues/${synced[0]}`, {
          cache: "no-store",
        });
        if (response.ok) {
          const state = (await response.json()) as QueueState;
          setActiveQueue({ id: synced[0], state });
          setCollectError("");
        }
      } catch {
        // Synced but snapshot fetch failed — outbox is already clear.
      }
    }
  }

  /**
   * Share the collection summary through whatever channel the phone is
   * best at — the native share sheet first (WhatsApp/SMS are how Indian
   * merchants actually send payment requests), WhatsApp web as the
   * fallback, clipboard as the last resort. Nothing leaves the device
   * beyond what the user chooses to send.
   */
  async function handleShare() {
    if (!result) return;
    const chunks = result.payments
      .map((payment) => formatINR(payment.amount))
      .join(" + ");
    const uniqueNote = result.uniqueAmounts
      ? " Every QR has a different amount, so one payment proof can never cover two codes."
      : "";
    const text =
      `Pay ${result.name} ${formatINR(result.total)} via UPI — ` +
      `${result.payments.length} QR code${result.payments.length > 1 ? "s" : ""}` +
      ` (${chunks}).${uniqueNote} Scan them one by one. UPI ID: ${result.upi}`;

    setShared(false);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: `Pay ${result.name}`, text });
        return;
      }
      window.open(
        `https://wa.me/?text=${encodeURIComponent(text)}`,
        "_blank",
        "noopener,noreferrer"
      );
    } catch {
      // User cancelled the share sheet, or share failed — copy instead so
      // the action still produces something useful.
      try {
        await navigator.clipboard.writeText(text);
        setShared(true);
        setTimeout(() => setShared(false), 2200);
      } catch {}
    }
  }

  function handleNewCollection() {
    setActiveQueue(null);
    setResult(null);
    setAmount("");
    setNote("");
    setError("");
    requestAnimationFrame(() => {
      document.getElementById("upi")?.focus({ preventScroll: true });
      document
        .querySelector(".form-card")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  const totalDisplay = result
    ? formatINR(result.total)
    : previewPayments.length
      ? formatINR(previewPayments.reduce((sum, paise) => sum + paise, 0))
      : "₹0.00";

  const qrCountDisplay = result
    ? result.payments.length
    : previewPayments.length || "—";

  return (
    <div className="workspace">
      <div style={{ gridColumn: "1 / -1" }}>
        <OfflineBanner
          pendingCount={pendingCount}
          syncing={syncing}
          onRetry={handleRetrySync}
        />
        {drafts.length > 0 && (
          <div className="offline-pending-list" aria-label="Pending offline collections">
            {drafts.slice(0, 3).map((draft) => (
              <div key={draft.idempotencyKey} className="offline-pending-row">
                <span>
                  Queued offline: {draft.payeeName} ·{" "}
                  {formatINR(
                    draft.amountsPaise.reduce((sum, value) => sum + value, 0)
                  )}
                  {draft.lastError ? ` — ${draft.lastError}` : ""}
                </span>
                <button
                  type="button"
                  className="offline-pending-dismiss"
                  onClick={() => {
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
      </div>
      <Card className="form-card">
        <CardHeader>
          <CardTitle>
            <h2>Payment details</h2>
          </CardTitle>
          <CardDescription>
            Add your UPI details and the full amount you’re owed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleGenerate}>
            <fieldset disabled={loading}>
              <div className="field">
                <Label htmlFor="upi">Your UPI ID</Label>
                <Input
                  id="upi"
                  value={upiId}
                  onChange={(event) =>
                    clearFeedback(() => setUpiId(event.target.value))
                  }
                  placeholder="name@bank"
                  maxLength={100}
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </div>
              <div className="field">
                <Label htmlFor="name">Account holder name</Label>
                <Input
                  id="name"
                  value={accountName}
                  onChange={(event) =>
                    clearFeedback(() => setAccountName(event.target.value))
                  }
                  placeholder="Full name"
                  maxLength={100}
                  autoComplete="name"
                  required
                />
              </div>
              <Separator className="form-separator" />
              <div className="field">
                <Label htmlFor="amount">Full amount to collect</Label>
                <div className="amount-input">
                  <span>₹</span>
                  <Input
                    id="amount"
                    value={amount}
                    onChange={(event) =>
                      clearFeedback(() => setAmount(sanitizeAmountInput(event.target.value)))
                    }
                    placeholder="0.00"
                    inputMode="decimal"
                    maxLength={12}
                    aria-describedby="amount-hint"
                    required
                  />
                  <span>INR</span>
                </div>
                <p id="amount-hint" className="field-hint">
                  Maximum ₹1,99,900 · Up to 100 QR codes
                </p>
              </div>
              <div className="field">
                <Label htmlFor="note">
                  Payment note <span className="optional">Optional</span>
                </Label>
                <Input
                  id="note"
                  value={note}
                  onChange={(event) =>
                    clearFeedback(() => setNote(event.target.value))
                  }
                  placeholder="e.g. Invoice 001"
                  maxLength={80}
                />
              </div>
              <div className={`unique-toggle${uniqueMode ? " active" : ""}`}>
                <div className="unique-toggle-copy">
                  <Label htmlFor="unique-mode" className="unique-toggle-label">
                    <ShieldCheck size={15} aria-hidden="true" />
                    Unique amount per QR
                    <span className="unique-toggle-tag">Anti-scam</span>
                  </Label>
                  <p id="unique-mode-hint" className="unique-toggle-hint">
                    Every code gets a different amount, so one paid screenshot can never be
                    reused on another QR. Total stays exactly the same.
                  </p>
                </div>
                <Switch
                  id="unique-mode"
                  checked={uniqueMode}
                  onCheckedChange={(checked) => clearFeedback(() => setUniqueMode(checked))}
                  aria-describedby="unique-mode-hint"
                />
              </div>
              {uniquePreviewError && (
                <p className="unique-toggle-error" role="alert">
                  {uniquePreviewError}
                </p>
              )}
              {error && (
                <Alert variant="destructive" className="form-error">
                  <AlertDescription className="text-destructive/90">
                    {error}
                  </AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                size="lg"
                className="generate"
                disabled={loading}
              >
                {loading && <LoaderCircle className="loading-icon" />}
                {loading ? "Generating…" : "Generate QR codes"}
                {!loading && <ArrowRight size={16} />}
              </Button>
            </fieldset>
          </form>
          <p className="privacy">
            <LockKeyhole size={12} aria-hidden="true" /> Payment details
            never leave your browser.
          </p>
        </CardContent>
      </Card>

      <section
        className="results"
        aria-labelledby="result-title"
        aria-live="polite"
        aria-busy={loading}
      >
        <div className="results-heading">
          <h2 id="result-title">Payment summary</h2>
          {result && (
            <div className="results-actions">
              <Button
                size="sm"
                className="start-collecting"
                onClick={handleStartCollecting}
                disabled={collecting}
              >
                {collecting && <LoaderCircle className="loading-icon" aria-hidden="true" />}
                <ScanLine size={15} aria-hidden="true" />
                {collecting ? "Opening…" : "Start collecting"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleShare}
                className="share-button"
                aria-label="Share payment request"
              >
                {shared ? <Check aria-hidden="true" /> : <Share2 aria-hidden="true" />}
                {shared ? "Copied" : "Share"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
                className="print-button"
              >
                <Printer aria-hidden="true" /> Print all
              </Button>
            </div>
          )}
          {collectError && (
            <Alert variant="destructive" className="form-error results-error">
              <AlertDescription className="text-destructive/90">
                {collectError}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <div className="summary-total">
          <span>Total to collect</span>
          <strong>{totalDisplay}</strong>
        </div>
        <div className="summary-row">
          <span>QR codes</span>
          <span>{qrCountDisplay}</span>
        </div>
        <div className="summary-row">
          <span>Amount per QR</span>
          <span>
            {(result ? result.uniqueAmounts : uniqueMode)
              ? "All different · anti-scam"
              : "Up to ₹1,999"}
          </span>
        </div>
        <Separator className="summary-separator" />
        {result ? (
          <>
            <div className="recipient">
              <div>
                <strong>{result.name}</strong>
                <span>{result.upi}</span>
              </div>
              <Badge className="rounded-full">Ready</Badge>
            </div>
            <div className="qr-grid">
              {result.payments.map((payment, index) => (
                <Card key={payment.link} className="qr-card">
                  <div className="qr-card-top">
                    <span>Payment {index + 1}</span>
                    {result.uniqueAmounts ? (
                      <span className="qr-unique-tag">
                        <ShieldCheck size={11} aria-hidden="true" /> Unique amount
                      </span>
                    ) : (
                      <span>of {result.payments.length}</span>
                    )}
                  </div>
                  <img
                    src={payment.image}
                    alt={`Payment ${index + 1}: ${formatINR(payment.amount)} to ${result.name}`}
                    width={240}
                    height={240}
                  />
                  <h3>{formatINR(payment.amount)}</h3>
                  <p className="qr-payee">{result.upi}</p>
                  <a
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                    href={payment.image}
                    download={`qr19-payment-${index + 1}-${(payment.amount / 100).toFixed(2)}.png`}
                  >
                    <Download size={14} aria-hidden="true" /> Download PNG
                  </a>
                </Card>
              ))}
            </div>
            <p className="result-note">
              {result.uniqueAmounts
                ? "Every QR carries a different amount — the amount that lands in your account tells you exactly which code was paid, so one payment proof can never cover two codes. "
                : ""}
              Scan each code once and confirm the amount in your UPI app. Each
              QR carries a unique order reference that the server tracks —
              tap “Start collecting” for the verified one-at-a-time screen,
              where the paid code swipes away and the next appears only after
              the payment provider confirms it.
            </p>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">
              <QrCode size={24} strokeWidth={1.5} aria-hidden="true" />
            </div>
            <h3>Collect every part of the payment</h3>
            <p>
              Generate QR codes of ₹1,999 or less.
              <br />
              Your customer pays each code to cover the full amount.
            </p>
            {previewPayments.length > 0 && (
              <div className="split-preview">
                {previewPayments.slice(0, 3).map((paymentPaise, index) => (
                  <Badge key={index} variant="outline">
                    {formatINR(paymentPaise)}
                  </Badge>
                ))}
                {previewPayments.length > 3 && (
                  <Badge variant="outline">
                    +{previewPayments.length - 3} more
                  </Badge>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {result && activeQueue && (
        <VerifiedPaymentMode
          queueId={activeQueue.id}
          initialState={activeQueue.state}
          onClose={() => setActiveQueue(null)}
          onNewCollection={handleNewCollection}
        />
      )}
    </div>
  );
}
