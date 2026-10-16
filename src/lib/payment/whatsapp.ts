/**
 * WhatsApp payment alerts (Meta WhatsApp Cloud API).
 *
 * Fire-and-forget notification sent the moment an order transitions to
 * `paid` in `service.ts`. Deliberately isolated from the money path:
 * - Opt-in via env; unset means "off" and costs nothing (no-tracking default).
 * - `WHATSAPP_ALERTS=demo` (or any non-"live" value) never hits the network —
 *   it logs what WOULD be sent, mirroring the UPI_LOOKUP_MODE=demo convention.
 * - `WHATSAPP_ALERTS=live` fails closed: missing/blank creds → off (logged).
 * - A send failure NEVER bubbles into the payment flow — every error is
 *   swallowed + logged here; the caller runs this fire-and-forget.
 * - Per-queue merchant enable (mobile Profile card → `PaymentQueue.
 *   whatsappAlerts` + `whatsappNumber`): when a queue enables alerts with a
 *   number while env is UNSET, that queue's paid orders produce demo-log
 *   alerts scoped to that number only. Real network sends still require the
 *   env live knob + creds — a merchant toggle alone can never make the
 *   server send through Meta.
 *
 * Message shape: Meta requires pre-approved HSM templates for the first
 * message to a recipient. We send a fixed `payment_received` template with
 * positional params (amount, seq, total, provider, providerRef).
 */

import { maskPhone } from "@/lib/upi-lookup/phone";

import type { EventActor } from "./service";

const TIMEOUT_MS = 8_000;

/** Meta Graph API major version. Bump deliberately — response shape is pinned to it. */
const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Env knob states. Anything other than "live"/"demo" (incl. unset) is off. */
export type WhatsAppAlertsMode = "off" | "demo" | "live";

export interface WhatsAppConfig {
  mode: WhatsAppAlertsMode;
  /** Meta Business phone-number id that sends (the business's WhatsApp number). */
  phoneNumberId: string;
  /** Permanent/system-user access token with whatsapp_business_messaging scope. */
  accessToken: string;
  /** Approved HSM template name for payment alerts. */
  templateName: string;
  /** BCP-47 template language code (e.g. "en", "hi_IN"). */
  languageCode: string;
  /** Recipient phone numbers in E.164 without "+" (e.g. "919876543210"). */
  recipients: string[];
}

/** Everything a payment alert carries. Amounts stay in integer paise. */
export interface PaidAlert {
  orderId: string;
  amountPaise: number;
  /** 1-based position of the order within its queue. */
  seq: number;
  /** Total orders in the queue — powers the "X of Y" phrasing. */
  totalOrders: number;
  /** Human provider label, e.g. "razorpay-live" | "demo". */
  provider: string;
  providerRef?: string;
}

/**
 * Parse + validate env into a config. Returns `null` when alerts are off.
 *
 * `globalRecipients` — env WHATSAPP_RECIPIENT + console-added numbers (stored
 * in the DB), merged (deduped, env order first).
 *
 * `queueAlerts` — per-queue merchant switch from the mobile Profile card.
 * When enabled with a number while the env knob is UNSET, a demo config is
 * returned scoped to that queue's number only (log-only; live still requires
 * the env live knob + creds). When env is demo/live, the queue number is
 * merged into the recipients iff the queue toggle is on. A disabled queue
 * never contributes its number, and a queue toggle alone (enabled without a
 * number) contributes nothing.
 */
export function resolveWhatsAppConfig(
  globalRecipients: readonly string[] = [],
  queueAlerts?: { enabled: boolean; number: string | null }
): WhatsAppConfig | null {
  const raw = (process.env.WHATSAPP_ALERTS ?? "").trim().toLowerCase();
  const envSelected = raw === "live" || raw === "demo";

  const queueNumber = queueAlerts?.number
    ? normalizeRecipientDigits(queueAlerts.number)
    : null;
  const queueEnabled = queueAlerts?.enabled === true && queueNumber !== null;

  // Env unset + no merchant enable → still fully off.
  if (!envSelected && !queueEnabled) return null;
  const mode: WhatsAppAlertsMode = raw === "live" ? "live" : "demo";

  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
  const accessToken = (process.env.WHATSAPP_ACCESS_TOKEN ?? "").trim();
  const templateName = (process.env.WHATSAPP_TEMPLATE_NAME ?? "payment_received").trim();
  const languageCode = (process.env.WHATSAPP_LANGUAGE_CODE ?? "en").trim();
  const recipients: string[] = [];

  if (envSelected) {
    for (const entry of parseRecipients(process.env.WHATSAPP_RECIPIENT ?? "")) {
      if (!recipients.includes(entry)) recipients.push(entry);
    }
    for (const entry of globalRecipients) {
      const digits = normalizeRecipientDigits(entry);
      if (digits && !recipients.includes(digits)) recipients.push(digits);
    }
    if (queueEnabled && queueNumber && !recipients.includes(queueNumber)) {
      recipients.push(queueNumber);
    }
  } else {
    // Merchant-enabled queue while env is unset: demo-logged, scoped to the
    // queue's own number — operator-level lists stay untouched.
    recipients.push(queueNumber!);
  }

  // Fail closed on live: creds must be present, or we degrade to off so a
  // half-configured deploy never spams errors or leaks tokens.
  if (mode === "live" && (!phoneNumberId || !accessToken || recipients.length === 0)) {
    console.warn(
      "[whatsapp] WHATSAPP_ALERTS=live but PHONE_NUMBER_ID / ACCESS_TOKEN / RECIPIENT is missing — alerts disabled (fail closed)."
    );
    return null;
  }

  return { mode, phoneNumberId, accessToken, templateName, languageCode, recipients };
}

/**
 * Normalize one entry to E.164 digits without "+". Accepts what humans type
 * ("+91 98765 43210", "91-98765-43210") and returns the digits (8-15) or
 * `null` when the entry is junk / out of range. Mirrors the per-entry rule
 * `parseRecipients` applies to env values; shared by the console's
 * "add number" endpoint and the DB-recipient merge.
 */
export function normalizeRecipientDigits(raw: string): string | null {
  const digits = raw.trim().replace(/^\+/, "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** The env recipient list, normalized — used for console dedupe checks. */
export function envRecipientNumbers(): string[] {
  return parseRecipients(process.env.WHATSAPP_RECIPIENT ?? "");
}

/** Split on commas/whitespace; keep only plausible E.164 digits (8–15). */
function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.replace(/^\+/, "").replace(/\D/g, ""))
    .filter((digits) => digits.length >= 8 && digits.length <= 15);
}

/** One masked recipient — country prefix kept, middle bullets, last 4 visible. */
export function maskRecipient(digits: string): string {
  const last10 = digits.slice(-10);
  return digits.length > 10 ? `${digits.slice(0, digits.length - 10)}-${maskPhone(last10)}` : maskPhone(last10);
}

/** Masked recipient list safe for any UI/log surface. */
export function maskedRecipients(config: WhatsAppConfig): string[] {
  return config.recipients.map(maskRecipient);
}

/**
 * Masked, secret-free status view for the PSP console (T5) + the test
 * endpoint (T4). Never exposes the access token or phone-number id — only
 * the resolved mode and masked recipients, so it is safe to return to the
 * admin UI.
 */
export interface WhatsAppStatus {
  /** Resolved state after the fail-closed rule: "off" | "demo" | "live". */
  mode: WhatsAppAlertsMode;
  /** True only when a real send would reach the network (live, fully configured). */
  configured: boolean;
  templateName: string;
  languageCode: string;
  /** E.164 recipients, masked (e.g. "91-XXXXXX3210") — env + console-added. Empty when off and none added. */
  recipients: string[];
  /** Operator-facing hint when live is selected but misconfigured. */
  reason?: string;
}

export function whatsappStatus(dbRecipients: readonly string[] = []): WhatsAppStatus {
  const raw = (process.env.WHATSAPP_ALERTS ?? "").trim().toLowerCase();
  const templateName = (process.env.WHATSAPP_TEMPLATE_NAME ?? "payment_received").trim();
  const languageCode = (process.env.WHATSAPP_LANGUAGE_CODE ?? "en").trim();
  // Console-added numbers are shown (masked) even when off / misconfigured so
  // the operator always sees what is stored.
  const addedMasked = dbRecipients
    .map((entry) => normalizeRecipientDigits(entry))
    .filter((digits): digits is string => digits !== null)
    .map(maskRecipient);

  if (raw !== "live" && raw !== "demo") {
    return { mode: "off", configured: false, templateName, languageCode, recipients: addedMasked };
  }

  const config = resolveWhatsAppConfig(dbRecipients);
  if (!config) {
    // live selected but fail-closed (missing creds and/or recipients).
    return {
      mode: "live",
      configured: false,
      templateName,
      languageCode,
      recipients: addedMasked,
      reason:
        addedMasked.length > 0
          ? "live selected but WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN is missing"
          : "live selected but WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN / WHATSAPP_RECIPIENT is missing",
    };
  }

  return {
    mode: config.mode,
    configured: config.mode === "live",
    templateName: config.templateName,
    languageCode: config.languageCode,
    recipients: maskedRecipients(config),
  };
}

/** Localized INR string, e.g. "₹1,999.00". Paise are exact. */
function formatINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Human demo/log line for an alert. Mirrors the template body so demo mode
 *  shows exactly what a live recipient would read. */
export function describePaidAlert(alert: PaidAlert): string {
  const ref = alert.providerRef ? ` (ref ${alert.providerRef})` : "";
  return `Payment received: ${formatINR(alert.amountPaise)} — order ${alert.seq} of ${alert.totalOrders} (${alert.provider})${ref} [${alert.orderId}]`;
}

/** Build the Cloud API template payload. Params must match the approved
 *  template's positional placeholders in order. */
function buildTemplatePayload(config: WhatsAppConfig, to: string, alert: PaidAlert): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: config.templateName,
      language: { code: config.languageCode },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: formatINR(alert.amountPaise) },
            { type: "text", text: String(alert.seq) },
            { type: "text", text: String(alert.totalOrders) },
            { type: "text", text: alert.provider },
            { type: "text", text: alert.providerRef ?? "—" },
          ],
        },
      ],
    },
  };
}

export interface SendResult {
  ok: boolean;
  /** Present on failure — never thrown; the money path must not see errors. */
  error?: string;
}

/** POST one template message to one recipient. Errors are returned, not thrown. */
export async function sendWhatsAppAlert(config: WhatsAppConfig, to: string, alert: PaidAlert): Promise<SendResult> {
  if (config.mode !== "live") {
    // Demo mode never touches the network.
    console.info(`[whatsapp:demo] would send to ${to}: ${describePaidAlert(alert)}`);
    return { ok: true };
  }

  try {
    const response = await fetch(`${GRAPH_BASE}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildTemplatePayload(config, to, alert)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const err = data?.error as { message?: string; code?: number } | undefined;
      return {
        ok: false,
        error: `HTTP ${response.status}${err?.code ? ` (${err.code})` : ""}: ${err?.message ?? "send failed"}`,
      };
    }
    return { ok: true };
  } catch (error) {
    // Timeout / network / JSON errors are contained here.
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Notify every configured recipient that an order was paid. Fire-and-forget:
 * never throws; returns per-recipient outcome so callers/tests can assert.
 * Demo mode logs and returns without network.
 */
export async function notifyPaid(
  alert: PaidAlert,
  actor: EventActor,
  configOverride?: WhatsAppConfig | null
): Promise<{ sent: number; failed: number }> {
  const config = configOverride !== undefined ? configOverride : resolveWhatsAppConfig();
  if (!config) return { sent: 0, failed: 0 };

  // The `actor` only enriches the demo log — live messages stay template-only.
  if (config.mode !== "live") {
    console.info(`[whatsapp:demo] paid event from actor="${actor}": ${describePaidAlert(alert)}`);
    return { sent: config.recipients.length, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  for (const to of config.recipients) {
    const result = await sendWhatsAppAlert(config, to, alert);
    if (result.ok) sent += 1;
    else {
      failed += 1;
      console.warn(`[whatsapp] send failed for ${to}: ${result.error}`);
    }
  }
  return { sent, failed };
}
