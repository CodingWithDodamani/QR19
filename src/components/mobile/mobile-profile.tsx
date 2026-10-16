"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Link from "next/link";
import { Check, Copy, MessageCircle, ShieldCheck } from "lucide-react";

import { useOnline } from "@/hooks/use-online";
import {
  loadMerchantProfile,
  loadWhatsAppAlertPrefs,
  saveMerchantProfile,
  saveWhatsAppAlertPrefs,
} from "@/lib/offline/notifications";
import { normalizeRecipientDigits } from "@/lib/payment/whatsapp";

import { tapTick } from "./mobile-shell";

interface PspStatus {
  configured: boolean;
  provider: string | null;
  env: string | null;
  enabled: boolean;
  keyIdMasked: string | null;
}

function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "₹";
  const parts = clean.split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * Profile: the on-device merchant identity (name + UPI ID — no accounts,
 * no passwords, nothing uploaded), payment-mode status, privacy guarantees,
 * and the scan-to-preview phone card.
 */
export function ProfileScreen() {
  const online = useOnline();
  const [name, setName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState<string | null>(null);
  const [appUrl, setAppUrl] = useState("");
  const [appQr, setAppQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [waEnabled, setWaEnabled] = useState(false);
  const [waNumber, setWaNumber] = useState("");
  const [waSaved, setWaSaved] = useState(false);
  const [waError, setWaError] = useState("");

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- intentional post-mount sync from device storage; cannot run during render without breaking hydration. */
    const profile = loadMerchantProfile();
    if (profile) {
      setName(profile.name);
      setUpiId(profile.upiId);
    }
    const waPrefs = loadWhatsAppAlertPrefs();
    setWaEnabled(waPrefs.enabled);
    setWaNumber(waPrefs.number);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/psp/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: (PspStatus & { mode?: string }) | null) => {
        if (!alive || !data) return;
        setMode(
          data.configured && data.provider
            ? `${data.provider}${data.env ? ` ${data.env}` : ""}`
            : "demo"
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // Post-hydration only: window.location differs between server and client.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-mount sync; cannot be computed during render without breaking hydration.
    setAppUrl(`${window.location.origin}/app`);
  }, []);

  useEffect(() => {
    if (!appUrl) return;
    let alive = true;
    QRCode.toDataURL(appUrl, {
      width: 480,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#182621", light: "#ffffff" },
    })
      .then((image) => {
        if (alive) setAppQr(image);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [appUrl]);

  function handleSave(event: React.FormEvent) {
    event.preventDefault();
    tapTick();
    saveMerchantProfile({ name: name.trim(), upiId: upiId.trim() });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  const waNumberValid = normalizeRecipientDigits(waNumber) !== null;

  function handleWaToggle() {
    tapTick();
    if (!waNumberValid) {
      setWaError("Add an alert number first, then switch on.");
      return;
    }
    setWaError("");
    const next = !waEnabled;
    setWaEnabled(next);
    saveWhatsAppAlertPrefs({ enabled: next, number: waNumber.trim() });
    setWaSaved(true);
    window.setTimeout(() => setWaSaved(false), 2200);
  }

  function handleWaSave() {
    tapTick();
    if (!waNumberValid) {
      setWaError("Enter a valid WhatsApp number with country code, e.g. +919876543210.");
      return;
    }
    setWaError("");
    saveWhatsAppAlertPrefs({ enabled: waEnabled, number: waNumber.trim() });
    setWaSaved(true);
    window.setTimeout(() => setWaSaved(false), 2200);
  }

  async function handleCopyLink() {
    if (!appUrl) return;
    tapTick();
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the QR still works
    }
  }

  return (
    <div className="ep-profile">
      <header className="ep-pagehead">
        <h1>Profile</h1>
        <p>Merchant identity lives only on this device</p>
      </header>

      <section className="ep-idcard" aria-label="Merchant identity">
        <span className="ep-idcard-avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <div>
          <p className="ep-idcard-name">{name.trim() || "Merchant"}</p>
          <p className="ep-idcard-sub">{upiId.trim() || "No UPI ID saved yet"}</p>
        </div>
        <span className={online ? "ep-pill ep-pill-on" : "ep-pill ep-pill-off"}>
          {online ? "Online" : "Offline"}
        </span>
      </section>

      <form className="ep-card" onSubmit={handleSave} aria-label="Edit merchant profile">
        <label className="ep-field">
          <span>Display name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Shop or your name"
            maxLength={100}
            autoComplete="name"
          />
        </label>
        <label className="ep-field">
          <span>UPI ID</span>
          <input
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
            placeholder="name@bank"
            maxLength={100}
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
          />
        </label>
        <button type="submit" className="ep-btn">
          {saved ? <Check size={16} aria-hidden="true" /> : null}
          {saved ? "Saved on this device" : "Save profile"}
        </button>
        <p className="ep-privacy">No account, no password, no upload — pre-fills the Collect form.</p>
      </form>

      <section className="ep-card" aria-label="WhatsApp payment alerts">
        <h2 className="ep-h2">
          <MessageCircle size={15} aria-hidden="true" /> WhatsApp payment alerts
        </h2>
        <button
          type="button"
          role="switch"
          aria-checked={waEnabled}
          aria-label="Enable WhatsApp payment alerts"
          className={waEnabled ? "ep-toggle ep-toggle-on" : "ep-toggle"}
          onClick={handleWaToggle}
        >
          <MessageCircle size={16} aria-hidden="true" />
          <span>
            Send a WhatsApp receipt on every payment <em>{waEnabled ? "on" : "off"}</em>
          </span>
          <span className="ep-switch" aria-hidden="true" />
        </button>
        <label className="ep-field">
          <span>Alert number <em>with country code</em></span>
          <input
            value={waNumber}
            onChange={(e) => {
              setWaNumber(e.target.value);
              setWaSaved(false);
              setWaError("");
            }}
            placeholder="+919876543210"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
          />
        </label>
        <button
          type="button"
          className="ep-btn-secondary"
          onClick={handleWaSave}
          aria-label="Save alert number on this device"
        >
          {waSaved ? <Check size={15} aria-hidden="true" /> : null}
          {waSaved ? "Saved on this device" : "Save alert number"}
        </button>
        {waError ? (
          <p className="ep-error" role="alert">{waError}</p>
        ) : null}
        <p className="ep-muted">
          When on, every verified payment in a collection started from this device sends this
          number a receipt — amount received, position in the split, total, provider. Demo
          servers log the receipt; real messages go out once the server&apos;s WhatsApp live
          mode is configured.
        </p>
      </section>

      <section className="ep-card" aria-label="Payment mode">
        <div className="ep-kv">
          <span>Payment mode</span>
          <strong>{mode ?? "…"}</strong>
        </div>
        <div className="ep-kv">
          <span>Verification</span>
          <strong>Provider-confirmed only</strong>
        </div>
        <p className="ep-muted">
          Connect a real provider in the website&apos;s PSP console to leave demo mode. Secrets stay encrypted on your
          server and are never shown here.
        </p>
      </section>

      <section className="ep-card" aria-label="Privacy and trust">
        <h2 className="ep-h2">
          <ShieldCheck size={15} aria-hidden="true" /> Privacy &amp; trust
        </h2>
        <ul className="ep-trust">
          <li>No tracking — no analytics, no accounts, no following.</li>
          <li>Merchant secrets stay encrypted on your own server; only masked previews ever display.</li>
          <li>Payments complete on provider confirmation alone — never on screenshots or claims.</li>
          <li>Event logs keep a redacted whitelist — no secrets in any log or response.</li>
        </ul>
      </section>

      <section className="ep-card ep-center" aria-label="Preview on your phone">
        <h2 className="ep-h2">Preview on your phone</h2>
        {appQr ? (
          <img src={appQr} alt="QR code linking to this app" width={180} height={180} className="ep-phoneqr" />
        ) : (
          <span className="ep-qrph" aria-hidden="true" />
        )}
        <p className="ep-muted">Scan with your phone camera. Your phone must reach this server.</p>
        <button type="button" className="ep-btn-secondary" onClick={handleCopyLink} disabled={!appUrl}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied ? "Link copied" : "Copy app link"}
        </button>
        <Link className="ep-link" href="/">
          Back to the QR19 website
        </Link>
      </section>

      <p className="ep-foot">QR19 · UPI is a product of NPCI. Not affiliated with NPCI or any payment app.</p>
    </div>
  );
}
