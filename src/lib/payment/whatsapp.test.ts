import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  describePaidAlert,
  maskedRecipients,
  normalizeRecipientDigits,
  notifyPaid,
  resolveWhatsAppConfig,
  sendWhatsAppAlert,
  whatsappStatus,
  type PaidAlert,
  type WhatsAppConfig,
} from "./whatsapp";

/**
 * Unit tests for the opt-in WhatsApp alerting module (pure env logic — no DB).
 *
 * Covered:
 * - env parsing: off by default, demo/live selection, live fail-closed rule
 * - recipient parsing (E.164, comma-separated, junk filtered)
 * - console-added recipients (PSP console input): merge/dedupe with the env
 *   list, live fail-closed interplay, masked status even when off
 * - message building (5 positional template params, INR formatting)
 * - demo mode never touches the network
 * - live send failure is contained (returns {ok:false}, never throws)
 * - masked recipients never leak full numbers
 */

const ENV_KEYS = [
  "WHATSAPP_ALERTS",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_RECIPIENT",
  "WHATSAPP_TEMPLATE_NAME",
  "WHATSAPP_LANGUAGE_CODE",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

const LIVE_ENV = {
  WHATSAPP_ALERTS: "live",
  WHATSAPP_PHONE_NUMBER_ID: "123456789012345",
  WHATSAPP_ACCESS_TOKEN: "test-token",
  WHATSAPP_RECIPIENT: "919876543210",
};

function setEnv(entries: Record<string, string>): void {
  for (const [key, value] of Object.entries(entries)) process.env[key] = value;
}

/** Wipe all WHATSAPP_* keys — sub-cases within one test must not leak into each other. */
function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

const ALERT: PaidAlert = {
  orderId: "ON99TEST01",
  amountPaise: 199900,
  seq: 2,
  totalOrders: 3,
  provider: "razorpay-live",
  providerRef: "pay_ABC123",
};

describe("resolveWhatsAppConfig", () => {
  it("returns null when the knob is unset (off is the default)", () => {
    expect(resolveWhatsAppConfig()).toBeNull();
  });

  it("returns null for any non-live/demo value incl. explicit off", () => {
    for (const value of ["off", "no", "true", "0", "", "DEMO-LIKE"]) {
      setEnv({ WHATSAPP_ALERTS: value });
      expect(resolveWhatsAppConfig()).toBeNull();
    }
  });

  it("trims + lowercases the knob", () => {
    setEnv({ WHATSAPP_ALERTS: "  Demo " });
    expect(resolveWhatsAppConfig()?.mode).toBe("demo");
  });

  it("resolves demo without credentials", () => {
    setEnv({ WHATSAPP_ALERTS: "demo" });
    const config = resolveWhatsAppConfig();
    expect(config).not.toBeNull();
    expect(config?.mode).toBe("demo");
    expect(config?.recipients).toEqual([]);
  });

  it("fails closed on live when any required piece is missing", () => {
    // Missing everything:
    clearEnv();
    setEnv({ WHATSAPP_ALERTS: "live" });
    expect(resolveWhatsAppConfig()).toBeNull();
    // Missing recipient only:
    clearEnv();
    setEnv({
      WHATSAPP_ALERTS: "live",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_ACCESS_TOKEN: "tok",
    });
    expect(resolveWhatsAppConfig()).toBeNull();
    // Missing token only:
    clearEnv();
    setEnv({
      WHATSAPP_ALERTS: "live",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_RECIPIENT: "919876543210",
    });
    expect(resolveWhatsAppConfig()).toBeNull();
    // Missing phone-number id only:
    clearEnv();
    setEnv({
      WHATSAPP_ALERTS: "live",
      WHATSAPP_ACCESS_TOKEN: "tok",
      WHATSAPP_RECIPIENT: "919876543210",
    });
    expect(resolveWhatsAppConfig()).toBeNull();
  });

  it("resolves live with full credentials", () => {
    setEnv(LIVE_ENV);
    const config = resolveWhatsAppConfig();
    expect(config).toMatchObject({
      mode: "live",
      phoneNumberId: "123456789012345",
      accessToken: "test-token",
      templateName: "payment_received",
      languageCode: "en",
      recipients: ["919876543210"],
    });
  });

  it("parses comma/whitespace recipients, strips +, filters junk", () => {
    setEnv({
      WHATSAPP_ALERTS: "live",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_ACCESS_TOKEN: "tok",
      WHATSAPP_RECIPIENT: "+919876543210, 919123456789 bogus 12,12345",
    });
    const config = resolveWhatsAppConfig();
    // Note: entries split on commas AND whitespace, so "+91 9876543210"
    // would be two entries — use compact E.164. "bogus"→"", "12"/"12345"
    // are too short — all filtered.
    expect(config?.recipients).toEqual(["919876543210", "919123456789"]);
  });
});

describe("whatsappStatus", () => {
  it("reports off with no recipients by default", () => {
    expect(whatsappStatus()).toMatchObject({ mode: "off", configured: false, recipients: [] });
  });

  it("reports demo as not configured (never reaches the network)", () => {
    setEnv({ WHATSAPP_ALERTS: "demo", WHATSAPP_RECIPIENT: "919876543210" });
    expect(whatsappStatus()).toMatchObject({ mode: "demo", configured: false });
  });

  it("reports live-misconfigured with an operator-facing reason", () => {
    setEnv({ WHATSAPP_ALERTS: "live" });
    const status = whatsappStatus();
    expect(status).toMatchObject({ mode: "live", configured: false, recipients: [] });
    expect(status.reason).toContain("WHATSAPP_ACCESS_TOKEN");
  });

  it("reports fully configured live with masked recipients only", () => {
    setEnv(LIVE_ENV);
    const status = whatsappStatus();
    expect(status).toMatchObject({ mode: "live", configured: true });
    expect(status.recipients).toHaveLength(1);
    // Masked: full number must never appear.
    expect(status.recipients[0]).not.toBe("919876543210");
    expect(status.recipients[0]).toContain("3210");
  });
});

describe("describePaidAlert (message building)", () => {
  it("renders amount, seq/total, provider and ref in the approved order", () => {
    const line = describePaidAlert(ALERT);
    expect(line).toContain("₹1,999.00");
    expect(line).toContain("order 2 of 3");
    expect(line).toContain("razorpay-live");
    expect(line).toContain("ref pay_ABC123");
    expect(line).toContain("[ON99TEST01]");
  });

  it("omits the ref segment when the provider sent none", () => {
    const line = describePaidAlert({ ...ALERT, providerRef: undefined });
    expect(line).not.toContain("(ref");
  });

  it("formats paise exactly (no float drift)", () => {
    const line = describePaidAlert({ ...ALERT, amountPaise: 1 });
    expect(line).toContain("₹0.01");
  });
});

describe("maskedRecipients", () => {
  it("never returns a full number", () => {
    const config: WhatsAppConfig = {
      mode: "demo",
      phoneNumberId: "",
      accessToken: "",
      templateName: "payment_received",
      languageCode: "en",
      recipients: ["919876543210", "123456789012345"],
    };
    const masked = maskedRecipients(config);
    expect(masked).toHaveLength(2);
    for (const entry of masked) {
      expect(entry).not.toMatch(/^\d{11,15}$/); // no raw E.164 passthrough
      expect(entry).toContain("•••••"); // middle digits hidden
    }
    // Last 4 stay visible for operator verification.
    expect(masked[0]).toBe("91-••••• 3210");
    expect(masked[1]).toBe("12345-••••• 2345");
  });
});

describe("demo mode never touches the network", () => {
  it("notifyPaid in demo logs and reports recipients without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const config: WhatsAppConfig = {
      mode: "demo",
      phoneNumberId: "123",
      accessToken: "tok",
      templateName: "payment_received",
      languageCode: "en",
      recipients: ["919876543210", "919123456789"],
    };
    const result = await notifyPaid(ALERT, "demo", config);
    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sendWhatsAppAlert in demo returns ok without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const config: WhatsAppConfig = {
      mode: "demo",
      phoneNumberId: "123",
      accessToken: "tok",
      templateName: "payment_received",
      languageCode: "en",
      recipients: ["919876543210"],
    };
    const result = await sendWhatsAppAlert(config, "919876543210", ALERT);
    expect(result.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("notifyPaid with no config (off) is a no-op", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await notifyPaid(ALERT, "webhook", null);
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("live send behavior", () => {
  const LIVE_CONFIG: WhatsAppConfig = {
    mode: "live",
    phoneNumberId: "123456789012345",
    accessToken: "test-token",
    templateName: "payment_received",
    languageCode: "en",
    recipients: ["919876543210", "919123456789"],
  };

  it("posts a template payload with the 5 positional params in order", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await sendWhatsAppAlert(LIVE_CONFIG, "919876543210", ALERT);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/123456789012345/messages");
    expect(url).toContain("graph.facebook.com");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");

    const body = JSON.parse(String(init.body)) as {
      messaging_product: string;
      to: string;
      template: {
        name: string;
        language: { code: string };
        components: Array<{ parameters: Array<{ text: string }> }>;
      };
    };
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.to).toBe("919876543210");
    expect(body.template.name).toBe("payment_received");
    expect(body.template.language.code).toBe("en");
    // The 5 positional params must match the approved template order:
    expect(body.template.components[0].parameters.map((p) => p.text)).toEqual([
      "₹1,999.00", // {{1}} amount
      "2", // {{2}} seq
      "3", // {{3}} total
      "razorpay-live", // {{4}} provider
      "pay_ABC123", // {{5}} providerRef
    ]);
  });

  it("contains HTTP failures as {ok:false} instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "Invalid OAuth access token", code: 190 } }),
      })
    );

    const result = await sendWhatsAppAlert(LIVE_CONFIG, "919876543210", ALERT);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
    expect(result.error).toContain("190");
  });

  it("contains network errors as {ok:false} instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection reset")));

    const result = await sendWhatsAppAlert(LIVE_CONFIG, "919876543210", ALERT);
    expect(result).toEqual({ ok: false, error: "connection reset" });
  });

  it("notifyPaid aggregates per-recipient outcomes and never throws", async () => {
    // First recipient succeeds, second fails — the money path must see neither.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    );

    const result = await notifyPaid(ALERT, "webhook", LIVE_CONFIG);
    expect(result).toEqual({ sent: 1, failed: 1 });
  });
});

describe("normalizeRecipientDigits", () => {
  it("accepts common international formats", () => {
    expect(normalizeRecipientDigits("+91 98765 43210")).toBe("919876543210");
    expect(normalizeRecipientDigits("91-98765-43210")).toBe("919876543210");
    expect(normalizeRecipientDigits("919876543210")).toBe("919876543210");
    expect(normalizeRecipientDigits("12345678")).toBe("12345678"); // 8-digit minimum
  });

  it("rejects junk and out-of-range lengths", () => {
    expect(normalizeRecipientDigits("")).toBeNull();
    expect(normalizeRecipientDigits("   ")).toBeNull();
    expect(normalizeRecipientDigits("abc")).toBeNull();
    expect(normalizeRecipientDigits("+")).toBeNull();
    expect(normalizeRecipientDigits("1234567")).toBeNull(); // 7 < 8
    expect(normalizeRecipientDigits("1234567890123456")).toBeNull(); // 16 > 15
  });
});

describe("console-added recipients (dbRecipients)", () => {
  it("merges + dedupes db numbers into the env list (env order first)", () => {
    setEnv({ WHATSAPP_ALERTS: "demo", WHATSAPP_RECIPIENT: "919876543210" });
    // "+91 98765 43210" is the env number in human format — must dedupe.
    const config = resolveWhatsAppConfig(["+91 98765 43210", "919123456789"]);
    expect(config?.recipients).toEqual(["919876543210", "919123456789"]);
  });

  it("lets live satisfy the recipient requirement from console numbers alone", () => {
    setEnv({
      WHATSAPP_ALERTS: "live",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_ACCESS_TOKEN: "tok",
    });
    expect(resolveWhatsAppConfig()).toBeNull(); // env-only still fails closed
    const config = resolveWhatsAppConfig(["919876543210"]);
    expect(config?.recipients).toEqual(["919876543210"]);
  });

  it("still fails closed on live when creds are missing, even with console numbers", () => {
    setEnv({ WHATSAPP_ALERTS: "live", WHATSAPP_PHONE_NUMBER_ID: "123" });
    expect(resolveWhatsAppConfig(["919876543210"])).toBeNull();
  });

  it("keeps demo never-network behavior with console numbers", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    setEnv({ WHATSAPP_ALERTS: "demo" });
    const config = resolveWhatsAppConfig(["919876543210"]);
    const result = await notifyPaid(ALERT, "demo", config);
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows console numbers (masked) in status even when off", () => {
    const status = whatsappStatus(["919876543210"]);
    expect(status.mode).toBe("off");
    expect(status.recipients).toHaveLength(1);
    expect(status.recipients[0]).not.toContain("9876543210");
    expect(status.recipients[0]).toContain("3210");
  });

  it("merges console numbers into live status recipients", () => {
    setEnv(LIVE_ENV);
    const status = whatsappStatus(["919123456789"]);
    expect(status).toMatchObject({ mode: "live", configured: true });
    expect(status.recipients).toHaveLength(2);
  });

  it("reason omits WHATSAPP_RECIPIENT when console numbers cover recipients", () => {
    setEnv({ WHATSAPP_ALERTS: "live", WHATSAPP_PHONE_NUMBER_ID: "123" });
    const status = whatsappStatus(["919876543210"]);
    expect(status.configured).toBe(false);
    expect(status.reason).toContain("WHATSAPP_ACCESS_TOKEN");
    expect(status.reason).not.toContain("WHATSAPP_RECIPIENT");
  });
});
