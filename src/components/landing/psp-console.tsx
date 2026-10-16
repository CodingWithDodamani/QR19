"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Check,
  CircleAlert,
  ClipboardCopy,
  ExternalLink,
  KeyRound,
  Landmark,
  LoaderCircle,
  MessageCircle,
  PlugZap,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Unplug,
  Webhook,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaytmIcon, PhonePeIcon } from "@/components/upi-pay/app-icons";
import { formatINR } from "@/lib/upi";
import { Reveal } from "./reveal";
import { SectionHeading } from "./section-heading";

/**
 * The REAL PSP console — multi-provider (PhonePe · Paytm · Razorpay).
 *
 * Honest framing, enforced by the UI copy:
 * - "demo" mode  → no PSP connected; advances are simulated and labeled.
 * - TEST/UAT/Staging → real PSP APIs with sandbox credentials; the verified
 *   pipeline (provisioning, signatures, polling) is genuinely exercised.
 * - LIVE/Production → real money. Every advance requires the provider's own
 *   confirmation. Nothing can be simulated.
 */

type Provider = "phonepe" | "paytm" | "razorpay";
type Mode =
  | "demo"
  | "live"
  | "razorpay-test"
  | "razorpay-live"
  | "phonepe-test"
  | "phonepe-live"
  | "paytm-test"
  | "paytm-live";

interface PspStatus {
  configured: boolean;
  enabled: boolean;
  provider: Provider | null;
  env: "test" | "live" | null;
  mode: Mode;
  keyIdMasked: string | null;
  webhookSecretConfigured: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  webhookUrl: string;
  usingInsecureEncryptionKey: boolean;
  providerDocs: string;
}

interface EventItem {
  id: string;
  kind: string;
  at: string;
  source: "webhook" | "poll" | "demo" | "synthetic" | "system" | "unknown";
  orderId?: string;
  amountPaise?: number;
  providerRef?: string;
  handled?: boolean;
  reason?: string;
}

interface FraudAlertItem {
  id: string;
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
  count: number;
  orderId: string | null;
  lastSeenAt: string;
}

const SEVERITY_CHIP: Record<FraudAlertItem["severity"], string> = {
  high: "pc-fraud-high",
  medium: "pc-fraud-medium",
  low: "pc-fraud-low",
};

const FRAUD_LABEL: Record<string, string> = {
  DUPLICATE_TXN_REF: "Reused payment proof",
  AMOUNT_MISMATCH: "Wrong amount",
  REPLAYED_SUCCESS: "Replayed success",
  STALE_ORDER_PAYMENT: "Payment for a closed QR",
  UNKNOWN_ORDER_PAYMENT: "Unknown order reference",
  SIGNATURE_FAIL: "Forged webhook attempt",
};

/* ---- WhatsApp payment alerts (env-driven, opt-in) ---- */
interface WhatsAppStatus {
  mode: "off" | "demo" | "live";
  configured: boolean;
  templateName: string;
  languageCode: string;
  recipients: string[];
  reason?: string;
}

interface WhatsAppTestResult {
  sent: number;
  failed: number;
  message: string;
}

/** One console-added alert recipient (list entry — masked, removable). */
interface WhatsAppRecipientEntry {
  id: string;
  masked: string;
}

const MODE_LABEL: Record<Mode, string> = {
  demo: "Demo — no PSP connected",
  live: "Live PSP (env webhook)",
  "phonepe-test": "PhonePe connected · UAT",
  "phonepe-live": "PhonePe connected · PRODUCTION",
  "paytm-test": "Paytm connected · Staging",
  "paytm-live": "Paytm connected · Production",
  "razorpay-test": "Razorpay connected · TEST keys",
  "razorpay-live": "Razorpay connected · LIVE keys",
};

const PROVIDER_CONNECTED_TEXT: Record<Provider, { test: string; live: string }> = {
  phonepe: {
    test:
      "UAT credentials are active. Payment pages are genuinely initiated through PhonePe's Pay API, but UAT transactions carry no real money — the server verifies through PhonePe's Check Payment Status API.",
    live:
      "Production credentials are active. Payments happen on PhonePe's hosted payment page and move real money into your PhonePe merchant account; each queue advances only on PhonePe's own confirmation.",
  },
  paytm: {
    test:
      "Staging credentials are active. Dynamic QRs are genuinely created through Paytm's Dynamic QR API, but staging transactions carry no real money — the server verifies through Paytm's Transaction Status API.",
    live:
      "Production credentials are active. Scanning a collection QR moves real money into your Paytm merchant account; each queue advances only on Paytm's own confirmation.",
  },
  razorpay: {
    test:
      "Test keys are active. QRs are genuinely created through Razorpay’s API, but test-mode QRs cannot be scanned by UPI apps — use the signed webhook test inside a collection to exercise the full pipeline before KYC.",
    live:
      "Live keys are active. Scanning a collection QR moves real money into your Razorpay account; each queue advances only on Razorpay’s own confirmation.",
  },
};

const PROVIDER_WEBHOOK_NOTE: Record<Provider, string> = {
  razorpay:
    "Dashboard → Account & Settings → Webhooks → Add New Webhook. Paste this URL, set a secret, enable qr_code.credited + payment.captured + payment.failed, and store the same secret here. Must be a public URL (localhost/tunnels are refused by Razorpay). Without a webhook secret, signed deliveries are refused and queues advance through provider polling instead.",
  phonepe:
    "No dashboard webhook setup needed: this app sends the callback URL with every Pay API request automatically. Verification uses your Salt Key + Salt Index (X-VERIFY) — there is no separate webhook secret. Callbacks only reach the app when APP_ORIGIN points at this deployment’s public URL; otherwise queues advance through PhonePe’s status API polling.",
  paytm:
    "Dashboard → Developer settings → Webhooks: register this URL for Dynamic QR / order status notifications. Verification uses your Merchant Key via the checksumhash header (HMAC-SHA256 base64) — there is no separate webhook secret. Deliveries that fail verification are refused (fail-closed) and queues advance through Paytm’s status API polling.",
};

const SOURCE_CHIP: Record<EventItem["source"], { label: string; className: string }> = {
  webhook: { label: "webhook", className: "pc-src-real" },
  poll: { label: "provider poll", className: "pc-src-real" },
  synthetic: { label: "synthetic", className: "pc-src-sim" },
  demo: { label: "simulated", className: "pc-src-sim" },
  system: { label: "system", className: "pc-src-sys" },
  unknown: { label: "event", className: "pc-src-sys" },
};

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function PspConsole() {
  const [status, setStatus] = useState<PspStatus | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  // P0-2: operator token input — stored tab-scoped in sessionStorage, sent as
  // `Authorization: Bearer` on every operator call below.
  const [adminTokenInput, setAdminTokenInput] = useState("");
  const [adminTokenSaved, setAdminTokenSaved] = useState(
    () =>
      typeof window !== "undefined" &&
      window.sessionStorage.getItem("qr19-admin-token") !== null
  );

  /* setup form (provider-scoped) */
  const [provider, setProvider] = useState<Provider>("phonepe");
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [env, setEnv] = useState<"test" | "live">("test");
  const [saltIndex, setSaltIndex] = useState<"0" | "1">("1");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* connected actions */
  const [testing, setTesting] = useState(false);
  const [unplugging, setUnplugging] = useState(false);

  /* monitor */
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [monitorAuthNeeded, setMonitorAuthNeeded] = useState(false);
  const [monitorBusy, setMonitorBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const monitorTimer = useRef<number | undefined>(undefined);

  /* fraud shield feed */
  const [fraudAlerts, setFraudAlerts] = useState<FraudAlertItem[] | null>(null);
  const [fraudAuthNeeded, setFraudAuthNeeded] = useState(false);
  const [fraudBusy, setFraudBusy] = useState(false);

  /* WhatsApp payment alerts (env opt-in) */
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [waAuthNeeded, setWaAuthNeeded] = useState(false);
  const [waBusy, setWaBusy] = useState(false);
  const [waTestResult, setWaTestResult] = useState<string | null>(null);
  const [waRecipients, setWaRecipients] = useState<WhatsAppRecipientEntry[]>([]);
  const [waNumber, setWaNumber] = useState("");
  const [waAddMsg, setWaAddMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /** P0-2: operator-only — Bearer token when the merchant saved one. */
  const adminHeaders = useCallback((): Record<string, string> => {
    const saved =
      typeof window !== "undefined" ? window.sessionStorage.getItem("qr19-admin-token") : null;
    return saved ? { Authorization: `Bearer ${saved}` } : {};
  }, []);

  /** Load the console-added numbers (id + masked) for the WhatsApp card. */
  const loadWaRecipients = useCallback(async () => {
    try {
      const response = await fetch("/api/psp/whatsapp-recipients", {
        cache: "no-store",
        headers: adminHeaders(),
      });
      if (response.ok) {
        const data = (await response.json()) as { recipients: WhatsAppRecipientEntry[] };
        setWaRecipients(data.recipients);
        setWaAuthNeeded(false);
      } else if (response.status === 401) {
        setWaAuthNeeded(true);
        setWaRecipients([]);
      }
    } catch {
      // transient — keep the previous list
    }
  }, [adminHeaders]);

  const refreshWhatsApp = useCallback(async () => {
    setWaBusy(true);
    try {
      const response = await fetch("/api/psp/whatsapp-test", {
        cache: "no-store",
        headers: adminHeaders(),
      });
      if (response.ok) {
        setWaStatus((await response.json()) as WhatsAppStatus);
        setWaAuthNeeded(false);
        await loadWaRecipients();
      } else if (response.status === 401) {
        setWaAuthNeeded(true);
        setWaStatus(null);
      }
    } catch {
      // transient
    } finally {
      setWaBusy(false);
    }
  }, [adminHeaders, loadWaRecipients]);

  const sendWhatsAppTest = useCallback(async () => {
    setWaBusy(true);
    setWaTestResult(null);
    try {
      const response = await fetch("/api/psp/whatsapp-test", {
        method: "POST",
        cache: "no-store",
        headers: adminHeaders(),
      });
      const data = (await response.json()) as WhatsAppStatus & Partial<WhatsAppTestResult>;
      if (response.ok || response.status === 409) {
        setWaStatus(data);
        setWaAuthNeeded(false);
        setWaTestResult(data.message ?? null);
      } else if (response.status === 401) {
        setWaAuthNeeded(true);
      } else {
        setWaTestResult(data.message ?? "Test alert failed — try again.");
      }
    } catch {
      setWaTestResult("Network error — the alert was not sent.");
    } finally {
      setWaBusy(false);
    }
  }, [adminHeaders]);

  const addWhatsAppNumber = useCallback(async () => {
    setWaBusy(true);
    setWaAddMsg(null);
    try {
      const response = await fetch("/api/psp/whatsapp-recipients", {
        method: "POST",
        cache: "no-store",
        headers: { ...adminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ number: waNumber }),
      });
      const data = (await response.json()) as { error?: string };
      if (response.status === 401) {
        setWaAuthNeeded(true);
      } else if (response.ok) {
        setWaAddMsg({
          ok: true,
          text: "Added — this number now receives every payment-received alert.",
        });
        setWaNumber("");
        await refreshWhatsApp();
      } else {
        setWaAddMsg({ ok: false, text: data.error ?? "The number could not be added." });
      }
    } catch {
      setWaAddMsg({ ok: false, text: "Network error — the number was not added." });
    } finally {
      setWaBusy(false);
    }
  }, [adminHeaders, refreshWhatsApp, waNumber]);

  const removeWhatsAppNumber = useCallback(async (entry: WhatsAppRecipientEntry) => {
    setWaBusy(true);
    setWaAddMsg(null);
    try {
      const response = await fetch(`/api/psp/whatsapp-recipients/${entry.id}`, {
        method: "DELETE",
        cache: "no-store",
        headers: adminHeaders(),
      });
      const data = (await response.json()) as { error?: string };
      if (response.status === 401) {
        setWaAuthNeeded(true);
      } else if (response.ok) {
        setWaAddMsg({ ok: true, text: `Removed ${entry.masked} from payment alerts.` });
        await refreshWhatsApp();
      } else {
        setWaAddMsg({ ok: false, text: data.error ?? "The number could not be removed." });
      }
    } catch {
      setWaAddMsg({ ok: false, text: "Network error — the number was not removed." });
    } finally {
      setWaBusy(false);
    }
  }, [adminHeaders, refreshWhatsApp]);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/psp/status", { cache: "no-store" });
      if (response.ok) setStatus((await response.json()) as PspStatus);
    } catch {
      // keep previous status
    }
  }, []);

  const refreshEvents = useCallback(async () => {
    setMonitorBusy(true);
    try {
      // P0-2: operator-only feed — Bearer token when the merchant saved one.
      const saved =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem("qr19-admin-token")
          : null;
      const response = await fetch("/api/psp/events", {
        cache: "no-store",
        headers: saved ? { Authorization: `Bearer ${saved}` } : undefined,
      });
      if (response.ok) {
        const data = (await response.json()) as { items: EventItem[] };
        setEvents(data.items);
        setMonitorAuthNeeded(false);
      } else if (response.status === 401) {
        setMonitorAuthNeeded(true);
        setEvents(null);
      }
    } catch {
      // transient
    } finally {
      setMonitorBusy(false);
    }
  }, []);

  const refreshFraud = useCallback(async () => {
    setFraudBusy(true);
    try {
      // P0-2: operator-only feed — Bearer token when the merchant saved one.
      const saved =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem("qr19-admin-token")
          : null;
      const response = await fetch("/api/psp/fraud-alerts", {
        cache: "no-store",
        headers: saved ? { Authorization: `Bearer ${saved}` } : undefined,
      });
      if (response.ok) {
        const data = (await response.json()) as { alerts: FraudAlertItem[] };
        setFraudAlerts(data.alerts);
        setFraudAuthNeeded(false);
      } else if (response.status === 401) {
        setFraudAuthNeeded(true);
        setFraudAlerts(null);
      }
    } catch {
      // transient
    } finally {
      setFraudBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    fetch("/api/upi-lookup/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { authenticated?: boolean }) => setAuthed(Boolean(data.authenticated)))
      .catch(() => setAuthed(false));
  }, [refreshStatus]);

  // Fraud Shield feed: useful in every mode (demo simulations raise real
  // alerts) — poll whenever signed in.
  useEffect(() => {
    if (authed !== true) return;
    void refreshFraud();
    const timer = window.setInterval(() => void refreshFraud(), 15_000);
    return () => window.clearInterval(timer);
  }, [authed, refreshFraud]);

  // WhatsApp alert status: read once when signed in (it only changes when the
  // operator edits env + restarts, so no polling — a Refresh button covers it).
  useEffect(() => {
    if (authed !== true) return;
    void refreshWhatsApp();
  }, [authed, refreshWhatsApp]);

  const connected =
    status?.mode === "razorpay-test" ||
    status?.mode === "razorpay-live" ||
    status?.mode === "phonepe-test" ||
    status?.mode === "phonepe-live" ||
    status?.mode === "paytm-test" ||
    status?.mode === "paytm-live";

  useEffect(() => {
    if (!connected || authed !== true) return;
    void refreshEvents();
    monitorTimer.current = window.setInterval(() => void refreshEvents(), 12_000);
    return () => window.clearInterval(monitorTimer.current);
  }, [connected, authed, refreshEvents]);

  function selectProvider(next: Provider) {
    if (next === provider) return;
    setProvider(next);
    setKeyId("");
    setKeySecret("");
    setWebhookSecret("");
    setSaltIndex("1");
    setEnv("test");
    setSaveMsg(null);
  }

  async function handleSignIn() {
    try {
      const response = await fetch("/api/upi-lookup/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Merchant" }),
      });
      if (response.ok) {
        setAuthed(true);
        void refreshFraud();
      }
    } catch {
      // surfaced by the next action
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveMsg(null);
    const payload = {
      provider,
      env,
      keyId,
      keySecret,
      saltIndex,
      webhookSecret: provider === "razorpay" ? webhookSecret : "",
    };
    try {
      const saved =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem("qr19-admin-token")
          : null;
      const authHeader: Record<string, string> = saved
        ? { Authorization: `Bearer ${saved}` }
        : {};
      let response = await fetch("/api/psp/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify(payload),
      });
      // The console is merchant-only: if the visitor is not signed in yet,
      // create the demo session automatically and retry exactly once.
      if (response.status === 401) {
        const signedIn = await fetch("/api/upi-lookup/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Merchant" }),
        });
        if (signedIn.ok) {
          setAuthed(true);
          response = await fetch("/api/psp/configure", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeader },
            body: JSON.stringify(payload),
          });
        }
      }
      const data = (await response.json()) as {
        error?: string;
        test?: { ok: boolean; message: string };
      };
      if (response.status === 401) {
        setAuthed(false);
        setSaveMsg({
          ok: false,
          text: "Operator sign-in required — paste your ADMIN_TOKEN below, then save again.",
        });
        return;
      }
      if (!response.ok) {
        setSaveMsg({ ok: false, text: data.error ?? "Could not save the credentials." });
        return;
      }
      setSaveMsg({
        ok: Boolean(data.test?.ok),
        text:
          data.test?.message ??
          "Saved. Run “Test connection” to verify the credentials against the provider.",
      });
      if (data.test?.ok) {
        setKeyId("");
        setKeySecret("");
        setWebhookSecret("");
      }
      await refreshStatus();
    } catch {
      setSaveMsg({ ok: false, text: "Network error while saving." });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    try {
      const response = await fetch("/api/psp/test", { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; message?: string; error?: string };
      setSaveMsg({
        ok: Boolean(data.ok),
        text: data.message ?? data.error ?? "Test finished.",
      });
      await refreshStatus();
    } catch {
      setSaveMsg({ ok: false, text: "Network error while testing." });
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    if (!unplugging) {
      // First click: arm the destructive action (auto-disarms after 3.5s).
      setUnplugging(true);
      window.setTimeout(() => setUnplugging(false), 3500);
      return;
    }
    setUnplugging(false);
    try {
      // P0-2: operator-only — Bearer token when the merchant saved one.
      const saved =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem("qr19-admin-token")
          : null;
      await fetch("/api/psp/configure", {
        method: "DELETE",
        headers: saved ? { Authorization: `Bearer ${saved}` } : undefined,
      });
      setEvents(null);
      await refreshStatus();
    } catch {
      // status refresh shows the truth
    }
  }

  function copyWebhookUrl() {
    if (!status) return;
    navigator.clipboard?.writeText(status.webhookUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  }

  const activeProvider = status?.provider ?? null;
  const activeEnvLabel =
    activeProvider === "phonepe"
      ? status?.env === "live"
        ? "PRODUCTION"
        : "UAT"
      : activeProvider === "paytm"
        ? status?.env === "live"
          ? "Production"
          : "Staging"
        : status?.env === "live"
          ? "LIVE"
          : "TEST";

  return (
    <section id="psp-console" className="scroll-mt-24 py-20 lg:py-28" aria-labelledby="psp-console-title">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          id="psp-console-title"
          kicker="Real PSP console"
          title={
            <>
              Connect a <span className="text-gradient">real payment provider</span>
            </>
          }
          subtitle="A raw UPI QR can be shown, but only a payment service provider can VERIFY that money actually arrived. Connect PhonePe, Paytm or Razorpay here and every sequential collection switches from simulated to genuinely provider-verified payments."
        />

        <Reveal delay={0.12} className="mx-auto mt-12 max-w-3xl">
          <div className="pc-card rounded-2xl border border-[#e3e8ef] bg-white p-6 shadow-[0_10px_40px_-18px_rgba(38,54,74,0.25)]">
            {!status ? (
              <div className="flex items-center gap-3 py-10 text-[#65748b]" role="status">
                <LoaderCircle className="animate-spin" size={18} aria-hidden="true" />
                Reading console state…
              </div>
            ) : (
              <>
                {/* ---------- status line ---------- */}
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`pc-mode-badge ${
                      status.mode.endsWith("-live") || status.mode === "live"
                        ? "pc-mode-live"
                        : connected
                          ? "pc-mode-test"
                          : "pc-mode-demo"
                    }`}
                  >
                    {status.mode.endsWith("-live") || status.mode === "live" ? (
                      <ShieldCheck size={13} aria-hidden="true" />
                    ) : (
                      <TriangleAlert size={13} aria-hidden="true" />
                    )}
                    {MODE_LABEL[status.mode]}
                  </span>
                  {status.keyIdMasked && (
                    <span className="pc-keychip" title={`Masked ${status.provider ?? ""} credential id`}>
                      <KeyRound size={12} aria-hidden="true" /> {status.keyIdMasked}
                    </span>
                  )}
                  {activeProvider === "razorpay" ? (
                    status.webhookSecretConfigured ? (
                      <span className="pc-flag pc-flag-ok">
                        <Webhook size={12} aria-hidden="true" /> webhook secret set
                      </span>
                    ) : (
                      <span className="pc-flag pc-flag-warn">
                        <Webhook size={12} aria-hidden="true" /> webhook secret missing
                      </span>
                    )
                  ) : (
                    activeProvider && (
                      <span className="pc-flag pc-flag-ok">
                        <ShieldCheck size={12} aria-hidden="true" /> callback verified with{" "}
                        {activeProvider === "phonepe" ? "salt key" : "merchant key"}
                      </span>
                    )
                  )}
                  {connected && (
                    <span className="pc-flag pc-flag-ok">
                      <Landmark size={12} aria-hidden="true" /> env {activeEnvLabel}
                    </span>
                  )}
                </div>

                {/* ---------- operator sign-in (P0-2) ---------- */}
                <div className="pc-webhook" style={{ marginTop: 12 }}>
                  <div className="pc-webhook-label">
                    Operator sign-in — ADMIN_TOKEN (required in production)
                  </div>
                  <div className="pc-webhook-row">
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder={adminTokenSaved ? "Token saved for this tab — paste a new one to replace" : "Paste ADMIN_TOKEN…"}
                      value={adminTokenInput}
                      onChange={(e) => setAdminTokenInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const value = adminTokenInput.trim();
                          if (!value) return;
                          try {
                            window.sessionStorage.setItem("qr19-admin-token", value);
                          } catch {
                            // ignore
                          }
                          setAdminTokenInput("");
                          setAdminTokenSaved(true);
                          setSaveMsg({ ok: true, text: "Operator token saved for this tab. Retrying…" });
                          void refreshFraud();
                          void refreshStatus();
                        }
                      }}
                      aria-label="Operator admin token"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!adminTokenInput.trim()}
                      onClick={() => {
                        const value = adminTokenInput.trim();
                        if (!value) return;
                        try {
                          window.sessionStorage.setItem("qr19-admin-token", value);
                        } catch {
                          // ignore
                        }
                        setAdminTokenInput("");
                        setAdminTokenSaved(true);
                        setSaveMsg({ ok: true, text: "Operator token saved for this tab. Retrying…" });
                        void refreshFraud();
                        void refreshStatus();
                      }}
                    >
                      <KeyRound size={14} aria-hidden="true" />
                      Save token
                    </Button>
                    {adminTokenSaved && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="pc-ghost-sm"
                        onClick={() => {
                          try {
                            window.sessionStorage.removeItem("qr19-admin-token");
                          } catch {
                            // ignore
                          }
                          setAdminTokenSaved(false);
                          setSaveMsg({ ok: false, text: "Operator token cleared." });
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <p className="pc-webhook-note">
                    {adminTokenSaved
                      ? "Token kept tab-scoped (sessionStorage) and sent as Authorization: Bearer. Never stored in a cookie."
                      : "Local dev still accepts the demo session; production requires this token (server refuses to boot without ADMIN_TOKEN). Generate with: openssl rand -hex 32"}
                  </p>
                </div>

                {status.mode === "demo" && (
                  <p className="mt-3 text-sm leading-relaxed text-[#65748b]">
                    Right now nothing can verify a real payment — advances only happen through the
                    clearly-labeled demo simulator. Connect <strong>PhonePe</strong> (hosted payment
                    page), <strong>Paytm</strong> (dynamic UPI QR) or <strong>Razorpay</strong>{" "}
                    (single-use fixed-amount QR) below, and the app starts talking to that
                    provider’s real API.
                  </p>
                )}

                {connected && (
                  <>
                    <p className="mt-3 text-sm leading-relaxed text-[#65748b]">
                      {status.env === "live"
                        ? PROVIDER_CONNECTED_TEXT[status.provider ?? "razorpay"].live
                        : PROVIDER_CONNECTED_TEXT[status.provider ?? "razorpay"].test}
                    </p>

                    {/* webhook / callback URL */}
                    <div className="pc-webhook">
                      <div className="pc-webhook-label">
                        {status.provider === "razorpay"
                          ? "Webhook URL for the Razorpay dashboard"
                          : status.provider === "phonepe"
                            ? "PhonePe callback URL (sent with every Pay API request)"
                            : "Callback URL for the Paytm dashboard"}
                      </div>
                      <div className="pc-webhook-row">
                        <code>{status.webhookUrl}</code>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={copyWebhookUrl}
                          aria-label="Copy webhook URL"
                        >
                          {copied ? <Check size={14} aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />}
                          {copied ? "Copied" : "Copy"}
                        </Button>
                      </div>
                      <p className="pc-webhook-note">{PROVIDER_WEBHOOK_NOTE[status.provider ?? "razorpay"]}</p>
                    </div>

                    {/* last test + actions */}
                    <div className="pc-actions">
                      {status.lastTestOk !== null && (
                        <p className={`pc-test-result ${status.lastTestOk ? "ok" : "bad"}`}>
                          {status.lastTestOk ? <BadgeCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
                          {status.lastTestMessage ?? ""}
                        </p>
                      )}
                      <div className="pc-actions-row">
                        <Button type="button" variant="outline" size="sm" onClick={handleTest} disabled={testing}>
                          {testing ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <PlugZap size={14} aria-hidden="true" />}
                          {testing ? "Testing…" : "Test connection"}
                        </Button>
                        <Button
                          type="button"
                          variant={unplugging ? "destructive" : "ghost"}
                          size="sm"
                          onClick={handleDisconnect}
                          className="pc-ghost-sm"
                        >
                          <Unplug size={14} aria-hidden="true" />
                          {unplugging ? "Click again to disconnect" : "Disconnect"}
                        </Button>
                      </div>
                      <p className="pc-field-note">
                        To switch providers, disconnect first — one provider is active at a time and
                        every queue verifies through exactly one of them.
                      </p>
                    </div>
                  </>
                )}

                {status.usingInsecureEncryptionKey && (
                  <p className="pc-insecure">
                    <TriangleAlert size={12} aria-hidden="true" />
                    Dev note: PSP_ENCRYPTION_KEY is not set — credential encryption uses a public
                    development key. Set a strong value before storing live credentials.
                  </p>
                )}

                {/* ---------- setup form (demo mode only) ---------- */}
                {status.mode === "demo" && (
                  <form className="pc-form" onSubmit={handleSave}>
                    {/* provider selector */}
                    <div className="pc-field" role="radiogroup" aria-label="Payment provider">
                      <Label>Provider</Label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={provider === "phonepe"}
                          onClick={() => selectProvider("phonepe")}
                          className={`flex items-center justify-center gap-2 rounded-lg border px-2 py-2.5 text-sm font-medium transition-colors ${
                            provider === "phonepe"
                              ? "border-[#5F259F] bg-[#5F259F]/5 text-[#5F259F]"
                              : "border-[#e3e8ef] text-[#65748b] hover:border-[#c8d1dd]"
                          }`}
                        >
                          <PhonePeIcon className="size-4 shrink-0" aria-hidden="true" />
                          PhonePe
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={provider === "paytm"}
                          onClick={() => selectProvider("paytm")}
                          className={`flex items-center justify-center gap-2 rounded-lg border px-2 py-2.5 text-sm font-medium transition-colors ${
                            provider === "paytm"
                              ? "border-[#002E6E] bg-[#002E6E]/5 text-[#002E6E]"
                              : "border-[#e3e8ef] text-[#65748b] hover:border-[#c8d1dd]"
                          }`}
                        >
                          <PaytmIcon className="size-4 shrink-0" aria-hidden="true" />
                          Paytm
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={provider === "razorpay"}
                          onClick={() => selectProvider("razorpay")}
                          className={`flex items-center justify-center gap-2 rounded-lg border px-2 py-2.5 text-sm font-medium transition-colors ${
                            provider === "razorpay"
                              ? "border-[#26364a] bg-[#26364a]/5 text-[#26364a]"
                              : "border-[#e3e8ef] text-[#65748b] hover:border-[#c8d1dd]"
                          }`}
                        >
                          <Landmark className="size-4 shrink-0" aria-hidden="true" />
                          Razorpay
                        </button>
                      </div>
                    </div>

                    {provider === "phonepe" && (
                      <div className="pc-form-head">
                        <PlugZap size={15} aria-hidden="true" />
                        <strong>Connect PhonePe</strong>
                        <span className="pc-steps-hint">
                          1. Sign up at the PhonePe Business dashboard → Payment Gateway · 2. Copy the
                          Merchant ID, Salt Key and Salt Index for your environment · 3. Paste them
                          here. Each order gets a real PhonePe-hosted payment page (no QR — PhonePe
                          hosts the page; the server verifies via the status API).
                        </span>
                      </div>
                    )}
                    {provider === "paytm" && (
                      <div className="pc-form-head">
                        <PlugZap size={15} aria-hidden="true" />
                        <strong>Connect Paytm</strong>
                        <span className="pc-steps-hint">
                          1. Get your MID + Merchant Key from the Paytm dashboard (Staging or
                          Production) · 2. Paste them here. Every order gets a real Paytm Dynamic QR
                          (businessType UPI_QR) verified through Paytm’s Transaction Status API.
                        </span>
                      </div>
                    )}
                    {provider === "razorpay" && (
                      <div className="pc-form-head">
                        <PlugZap size={15} aria-hidden="true" />
                        <strong>Connect Razorpay</strong>
                        <span className="pc-steps-hint">
                          1. Sign up at dashboard.razorpay.com (test keys are instant, no KYC) · 2. Request
                          the QR Codes product for your account (it is on-demand) · 3. Paste the keys here.
                        </span>
                      </div>
                    )}

                    {provider !== "razorpay" && (
                      <div className="pc-field">
                        <Label>Environment</Label>
                        <div className="flex gap-2" role="radiogroup" aria-label="Environment">
                          <button
                            type="button"
                            role="radio"
                            aria-checked={env === "test"}
                            onClick={() => setEnv("test")}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                              env === "test"
                                ? "border-[#26364a] bg-[#26364a]/5 text-[#26364a]"
                                : "border-[#e3e8ef] text-[#65748b] hover:border-[#c8d1dd]"
                            }`}
                          >
                            {provider === "phonepe" ? "UAT (test)" : "Staging (test)"}
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={env === "live"}
                            onClick={() => setEnv("live")}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                              env === "live"
                                ? "border-[#16754b] bg-[#16754b]/5 text-[#16754b]"
                                : "border-[#e3e8ef] text-[#65748b] hover:border-[#c8d1dd]"
                            }`}
                          >
                            {provider === "phonepe" ? "Production" : "Production"}
                          </button>
                        </div>
                        <p className="pc-field-note">
                          Test/UAT environments verify signatures for real but carry no real money —
                          a safe way to exercise the whole pipeline before activation.
                        </p>
                      </div>
                    )}

                    <div className="pc-field">
                      <Label htmlFor="psp-key-id">
                        {provider === "razorpay"
                          ? "Key ID"
                          : provider === "phonepe"
                            ? "Merchant ID"
                            : "MID (Merchant ID)"}
                      </Label>
                      <Input
                        id="psp-key-id"
                        value={keyId}
                        onChange={(event) => setKeyId(event.target.value)}
                        placeholder={
                          provider === "razorpay"
                            ? "rzp_test_… or rzp_live_…"
                            : provider === "phonepe"
                              ? "Merchant ID from the PhonePe dashboard"
                              : "MID from the Paytm dashboard"
                        }
                        autoComplete="off"
                        spellCheck={false}
                        autoCapitalize="none"
                        required
                      />
                    </div>
                    <div className="pc-field">
                      <Label htmlFor="psp-key-secret">
                        {provider === "razorpay"
                          ? "Key Secret"
                          : provider === "phonepe"
                            ? "Salt Key"
                            : "Merchant Key"}
                      </Label>
                      <Input
                        id="psp-key-secret"
                        type="password"
                        value={keySecret}
                        onChange={(event) => setKeySecret(event.target.value)}
                        placeholder="Saved encrypted, never displayed again"
                        autoComplete="new-password"
                        required
                      />
                    </div>

                    {provider === "phonepe" && (
                      <div className="pc-field">
                        <Label htmlFor="psp-salt-index">Salt Index</Label>
                        <select
                          id="psp-salt-index"
                          value={saltIndex}
                          onChange={(event) => setSaltIndex(event.target.value === "0" ? "0" : "1")}
                          className="h-9 w-full rounded-md border border-[#d5dce6] bg-white px-3 text-sm text-[#26364a]"
                        >
                          <option value="1">1 (default)</option>
                          <option value="0">0</option>
                        </select>
                        <p className="pc-field-note">
                          The X-VERIFY checksum is computed with this index — it must match the Salt
                          Key’s index shown in the PhonePe dashboard.
                        </p>
                      </div>
                    )}

                    {provider === "razorpay" && (
                      <div className="pc-field">
                        <Label htmlFor="psp-webhook-secret">
                          Webhook secret <span className="pc-optional">recommended</span>
                        </Label>
                        <Input
                          id="psp-webhook-secret"
                          type="password"
                          value={webhookSecret}
                          onChange={(event) => setWebhookSecret(event.target.value)}
                          placeholder="Same secret you enter in the Razorpay dashboard"
                          autoComplete="new-password"
                        />
                        <p className="pc-field-note">
                          Webhooks without a verifiable signature are refused (fail-closed). If you skip
                          this, queues still advance by polling Razorpay’s API.
                        </p>
                      </div>
                    )}

                    {authed === false && (
                      <p className="pc-auth-note">
                        <CircleAlert size={13} aria-hidden="true" />
                        PSP settings are merchant-only — you’ll be signed in automatically when you save.
                      </p>
                    )}
                    {saveMsg && (
                      <p className={`pc-save-msg ${saveMsg.ok ? "ok" : "bad"}`} role="status">
                        {saveMsg.ok ? <BadgeCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
                        {saveMsg.text}
                      </p>
                    )}
                    <div className="pc-form-actions">
                      <Button type="submit" size="sm" className="pc-save" disabled={saving}>
                        {saving && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}
                        Save &amp; test connection
                      </Button>
                      <a
                        className="pc-docs-link"
                        href={provider === "razorpay"
                          ? "https://razorpay.com/docs/payments/qr-codes/"
                          : provider === "phonepe"
                            ? "https://developer.phonepe.com/api"
                            : "https://developer.paytm.in/docs/"}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {provider === "razorpay"
                          ? "QR Codes API docs"
                          : provider === "phonepe"
                            ? "PhonePe PG API docs"
                            : "Paytm Dynamic QR docs"}{" "}
                        <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    </div>
                  </form>
                )}

                {/* ---------- live monitor ---------- */}
                {connected && (
                  <div className="pc-monitor">
                    <div className="pc-monitor-head">
                      <strong>Live provider events</strong>
                      <span>real webhook + poll ledger · auto-refreshes</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void refreshEvents()}
                        disabled={monitorBusy}
                        aria-label="Refresh events"
                      >
                        <RefreshCw size={13} className={monitorBusy ? "animate-spin" : ""} aria-hidden="true" />
                        Refresh
                      </Button>
                    </div>
                    {authed === false || monitorAuthNeeded ? (
                      <div className="pc-monitor-gate">
                        <p>The event monitor shows payment data — it is operator-only.</p>
                        <Button type="button" size="sm" onClick={handleSignIn}>
                          Sign in as merchant
                        </Button>
                      </div>
                    ) : events === null ? (
                      <p className="pc-monitor-empty" role="status">Loading events…</p>
                    ) : events.length === 0 ? (
                      <p className="pc-monitor-empty">
                        No provider events yet. Start a collection — provisioning and payments will
                        appear here.
                      </p>
                    ) : (
                      <ul className="pc-monitor-list" aria-live="polite">
                        {events.map((item) => {
                          const chip = SOURCE_CHIP[item.source] ?? SOURCE_CHIP.unknown;
                          return (
                            <li key={item.id} className="pc-monitor-row">
                              <span className={`pc-src ${chip.className}`}>{chip.label}</span>
                              <span className="pc-kind">{item.kind}</span>
                              {item.amountPaise !== undefined && (
                                <span className="pc-amount">{formatINR(item.amountPaise)}</span>
                              )}
                              {item.reason && <span className="pc-reason">{item.reason}</span>}
                              <time dateTime={item.at}>{timeAgo(item.at)}</time>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {/* ---------- fraud shield ---------- */}
                <div className="pc-monitor pc-fraud">
                  <div className="pc-monitor-head">
                    <strong>
                      <ShieldAlert size={13} aria-hidden="true" /> Fraud alerts
                    </strong>
                    <span>reused proofs · wrong amounts · forged webhooks</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void refreshFraud()}
                      disabled={fraudBusy}
                      aria-label="Refresh fraud alerts"
                    >
                      <RefreshCw size={13} className={fraudBusy ? "animate-spin" : ""} aria-hidden="true" />
                      Refresh
                    </Button>
                  </div>
                  {authed === false || fraudAuthNeeded ? (
                    <div className="pc-monitor-gate">
                      <p>
                        Fraud alerts touch payment data — they are operator-only.
                        Every blocked scam attempt (reused proof, wrong amount, forged
                        webhook) is listed here.
                      </p>
                      <Button type="button" size="sm" onClick={handleSignIn}>
                        Sign in as merchant
                      </Button>
                    </div>
                  ) : fraudAlerts === null ? (
                    <p className="pc-monitor-empty" role="status">Loading fraud alerts…</p>
                  ) : fraudAlerts.length === 0 ? (
                    <p className="pc-monitor-empty">
                      No fraud signals recorded. When a customer shows an old payment
                      proof, pays the wrong amount, or a forged webhook arrives, it
                      will be blocked and listed here.
                    </p>
                  ) : (
                    <ul className="pc-monitor-list pc-fraud-list" aria-live="polite">
                      {fraudAlerts.map((alert) => (
                        <li key={alert.id} className={`pc-fraud-row ${SEVERITY_CHIP[alert.severity] ?? ""}`}>
                          <span className="pc-fraud-type">
                            <ShieldAlert size={12} aria-hidden="true" />
                            {FRAUD_LABEL[alert.type] ?? alert.type.toLowerCase()}
                            {alert.count > 1 && <em className="pc-fraud-count">×{alert.count}</em>}
                          </span>
                          <span className="pc-fraud-msg">{alert.message}</span>
                          <time dateTime={alert.lastSeenAt}>{timeAgo(alert.lastSeenAt)}</time>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* ---------- WhatsApp payment alerts ---------- */}
                <div className="pc-monitor pc-fraud">
                  <div className="pc-monitor-head">
                    <strong>
                      <MessageCircle size={13} aria-hidden="true" /> WhatsApp payment alerts
                    </strong>
                    <span>opt-in via WHATSAPP_ALERTS env · sent the moment a payment is verified</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void refreshWhatsApp()}
                      disabled={waBusy}
                      aria-label="Refresh WhatsApp alert status"
                    >
                      <RefreshCw size={13} className={waBusy ? "animate-spin" : ""} aria-hidden="true" />
                      Refresh
                    </Button>
                  </div>
                  {authed === false || waAuthNeeded ? (
                    <div className="pc-monitor-gate">
                      <p>
                        Alert configuration is operator-only. It shows which recipients get paid
                        alerts and whether sending is live — never the access token.
                      </p>
                      <Button type="button" size="sm" onClick={handleSignIn}>
                        Sign in as merchant
                      </Button>
                    </div>
                  ) : waStatus === null ? (
                    <p className="pc-monitor-empty" role="status">Loading alert status…</p>
                  ) : (
                    <>
                      <ul className="pc-monitor-list" aria-live="polite">
                        <li className="pc-fraud-row pc-fraud-low">
                          <span className="pc-fraud-type">
                            <MessageCircle size={12} aria-hidden="true" /> Sending
                          </span>
                          <span className="pc-fraud-msg">
                            {waStatus.mode === "off" && "Off — no WhatsApp alerts are sent (default)."}
                            {waStatus.mode === "demo" &&
                              `Demo — messages are logged to the server console, never sent to the network.`}
                            {waStatus.mode === "live" &&
                              (waStatus.configured
                                ? "Live — real messages go to the Meta WhatsApp Cloud API."
                                : `Live selected but not sending: ${waStatus.reason ?? "misconfigured"}.`)}
                          </span>
                        </li>
                        <li className="pc-fraud-row pc-fraud-low">
                          <span className="pc-fraud-type">
                            <Send size={12} aria-hidden="true" /> Recipients
                          </span>
                          <span className="pc-fraud-msg">
                            {waStatus.recipients.length > 0
                              ? waStatus.recipients.join(", ")
                              : "None configured."}
                          </span>
                        </li>
                        <li className="pc-fraud-row pc-fraud-low">
                          <span className="pc-fraud-type">
                            <ShieldCheck size={12} aria-hidden="true" /> Template
                          </span>
                          <span className="pc-fraud-msg">
                            {waStatus.templateName} · {waStatus.languageCode} · params: amount, seq,
                            total, provider, providerRef
                          </span>
                        </li>
                      </ul>
                      {waTestResult !== null && (
                        <p className="pc-monitor-empty" role="status">{waTestResult}</p>
                      )}
                      {/* ---------- console-added alert numbers ---------- */}
                      <div className="mt-3">
                        <div className="pc-webhook-label">Alert numbers added here</div>
                        {waRecipients.length > 0 ? (
                          <ul className="pc-monitor-list" aria-live="polite">
                            {waRecipients.map((entry) => (
                              <li key={entry.id} className="pc-fraud-row pc-fraud-low">
                                <span className="pc-fraud-msg">
                                  <MessageCircle size={12} aria-hidden="true" /> {entry.masked}
                                </span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void removeWhatsAppNumber(entry)}
                                  disabled={waBusy}
                                  aria-label={`Remove ${entry.masked} from payment alerts`}
                                >
                                  <X size={12} aria-hidden="true" />
                                  Remove
                                </Button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="pc-monitor-empty" role="note">
                            No numbers added yet — recipients from WHATSAPP_RECIPIENT still apply.
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input
                            type="tel"
                            inputMode="tel"
                            autoComplete="off"
                            placeholder="e.g. 919876543210"
                            aria-label="WhatsApp number in full international format"
                            value={waNumber}
                            onChange={(event) => setWaNumber(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" && waNumber.trim() && !waBusy) {
                                event.preventDefault();
                                void addWhatsAppNumber();
                              }
                            }}
                            disabled={waBusy}
                            className="h-9 w-[210px]"
                          />
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void addWhatsAppNumber()}
                            disabled={waBusy || !waNumber.trim()}
                            aria-label="Add WhatsApp number"
                          >
                            <Plus size={13} aria-hidden="true" />
                            Add number
                          </Button>
                        </div>
                        {waAddMsg !== null && (
                          <p
                            className="pc-monitor-empty"
                            role={waAddMsg.ok ? "status" : "alert"}
                          >
                            {waAddMsg.text}
                          </p>
                        )}
                        <p className="pc-monitor-empty" role="note">
                          Full international format, digits only (8-15, e.g. 919876543210). Added
                          numbers receive alerts together with <code>WHATSAPP_RECIPIENT</code>; the
                          off/demo/live switch still comes from <code>WHATSAPP_ALERTS</code>.
                        </p>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void sendWhatsAppTest()}
                          disabled={waBusy || waStatus.mode === "off"}
                          aria-label="Send test alert"
                        >
                          {waBusy ? (
                            <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
                          ) : (
                            <Send size={13} aria-hidden="true" />
                          )}
                          Send test alert
                        </Button>
                        {waStatus.mode === "off" && (
                          <p className="pc-monitor-empty" role="note">
                            Set <code>WHATSAPP_ALERTS=demo</code> (or <code>live</code> + creds) in
                            your environment and restart to enable.
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* ---------- honesty strip ---------- */}
                <ul className="pc-honesty">
                  <li>
                    <Check size={12} aria-hidden="true" /> Works today: real APIs for all three
                    providers, signature-verified callbacks, provider status polling, encrypted
                    credential storage.
                  </li>
                  <li>
                    <TriangleAlert size={12} aria-hidden="true" /> Needs your action: merchant
                    accounts + approved credentials (PhonePe UAT/activation, Paytm Staging keys,
                    Razorpay QR Codes product) and a public URL for callbacks.
                  </li>
                  <li>
                    <CircleAlert size={12} aria-hidden="true" /> Check each provider’s fees (Razorpay
                    applies a ~2% + GST platform fee on UPI despite zero MDR; PhonePe/Paytm pricing
                    differs per plan).
                  </li>
                </ul>
              </>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
