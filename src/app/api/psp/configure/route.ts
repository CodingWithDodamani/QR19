import { NextResponse } from "next/server";

import {
  isAdminRequest,
  publicOrigin,
  unauthorized,
} from "@/lib/payment/psp-auth";
import { rateLimit } from "@/lib/payment/rate-limit";
import {
  clearPspSettings,
  getPspStatus,
  invalidateModeCache,
  isPspProvider,
  recordConnectionTest,
  resolvePaymentMode,
  savePspSettings,
  type DecryptedPspCredentials,
} from "@/lib/payment/psp-settings";
import { paytmTestConnection } from "@/lib/payment/paytm";
import { phonepeTestConnection } from "@/lib/payment/phonepe";
import { razorpayTestConnection } from "@/lib/payment/razorpay";
import type { PspProvider } from "@/lib/payment/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/psp/configure — save REAL PSP credentials (session-gated).
 *
 * Body: { provider, env?, keyId, keySecret, saltIndex?, webhookSecret? }
 *
 * - Credentials are validated per provider (format-level), then immediately
 *   tested against the provider's REAL API:
 *     razorpay → HTTP Basic probe (GET /payments?count=1)
 *     phonepe  → signed status probe (checksum verified before lookup)
 *     paytm    → checksummed status probe (checksum verified before lookup)
 *   The result is returned honestly — saving succeeds either way, but
 *   `test.ok` tells the merchant whether the credentials actually work.
 * - Secrets are stored AES-256-GCM encrypted and are never returned by any
 *   endpoint afterwards (only a masked key id preview).
 * - Saving clears the last-test state (the next signed delivery / test run
 *   re-verifies).
 */

const PROVIDER_LABEL: Record<PspProvider, string> = {
  razorpay: "Razorpay",
  phonepe: "PhonePe",
  paytm: "Paytm",
};

function providerWebhookUrl(provider: PspProvider, request: Request): string {
  return `${publicOrigin(request)}/api/webhooks/${provider}`;
}

export async function POST(request: Request) {
  // P0-2: operator-only — ADMIN_TOKEN bearer in prod, demo session locally.
  if (!isAdminRequest(request)) return unauthorized();

  const limit = await rateLimit(request, "pspConfigure");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  let body: {
    provider?: unknown;
    env?: unknown;
    keyId?: unknown;
    keySecret?: unknown;
    saltIndex?: unknown;
    webhookSecret?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const provider = String(body.provider ?? "").trim();
  if (!isPspProvider(provider)) {
    return NextResponse.json(
      { error: "provider must be one of: razorpay, phonepe, paytm." },
      { status: 400 }
    );
  }

  const keyId = String(body.keyId ?? "").trim();
  const keySecret = String(body.keySecret ?? "").trim();
  const webhookSecret = String(body.webhookSecret ?? "").trim();
  const env = String(body.env ?? "").trim() === "live" ? "live" : "test";
  const saltIndex = String(body.saltIndex ?? "1").trim() === "0" ? "0" : "1";

  /* ------------------ per-provider format validation ----------------- */
  if (provider === "razorpay") {
    if (!/^rzp_(test|live)_[A-Za-z0-9]{8,}$/.test(keyId)) {
      return NextResponse.json(
        {
          error:
            "Key ID must look like rzp_test_… or rzp_live_… — copy it from the Razorpay dashboard (Account & Settings → API Keys).",
        },
        { status: 400 }
      );
    }
    if (keySecret.length < 8) {
      return NextResponse.json(
        { error: "Key Secret is required — copy it from the same Razorpay API Keys page." },
        { status: 400 }
      );
    }
  } else if (provider === "phonepe") {
    if (!keyId) {
      return NextResponse.json(
        { error: "Merchant ID is required — copy it from the PhonePe Business dashboard." },
        { status: 400 }
      );
    }
    if (keySecret.length < 8) {
      return NextResponse.json(
        { error: "Salt Key must be at least 8 characters — copy it from the PhonePe Business dashboard (UAT or Production, matching the environment)." },
        { status: 400 }
      );
    }
  } else {
    if (!keyId) {
      return NextResponse.json(
        { error: "MID (Merchant ID) is required — copy it from the Paytm dashboard." },
        { status: 400 }
      );
    }
    if (keySecret.length < 16) {
      return NextResponse.json(
        { error: "Merchant Key must be at least 16 characters — copy it from the Paytm dashboard API keys page." },
        { status: 400 }
      );
    }
  }

  await savePspSettings({
    provider,
    env,
    keyId,
    keySecret,
    webhookSecret: webhookSecret || null,
    saltIndex,
  });
  invalidateModeCache();

  // Immediately prove (or disprove) the credentials against the real API.
  const creds: DecryptedPspCredentials = {
    provider,
    env: provider === "razorpay" ? (keyId.startsWith("rzp_live_") ? "live" : "test") : env,
    keyId,
    keySecret,
    webhookSecret: webhookSecret || null,
    saltIndex,
  };
  let test: { ok: boolean; message: string };
  try {
    if (provider === "razorpay") {
      const { keyMode } = await razorpayTestConnection(creds);
      test = {
        ok: true,
        message: `Connected to Razorpay (${keyMode} mode). The API accepted these credentials.`,
      };
    } else if (provider === "phonepe") {
      await phonepeTestConnection(creds);
      test = {
        ok: true,
        message: `Connected to PhonePe (${creds.env === "live" ? "PRODUCTION" : "UAT"}). The gateway verified the Merchant ID + Salt Key checksum.`,
      };
    } else {
      await paytmTestConnection(creds);
      test = {
        ok: true,
        message: `Connected to Paytm (${creds.env === "live" ? "PRODUCTION" : "Staging"}). The gateway verified the MID + Merchant Key checksum.`,
      };
    }
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? error.message : "the provider could not be reached";
    test = {
      ok: false,
      message: `${PROVIDER_LABEL[provider]} rejected the credentials: ${detail}`,
    };
  }
  await recordConnectionTest(test.ok, test.message);

  const [status, mode] = await Promise.all([getPspStatus(), resolvePaymentMode()]);
  return NextResponse.json({
    saved: true,
    test,
    status: { ...status, mode, webhookUrl: providerWebhookUrl(provider, request) },
  });
}

/**
 * DELETE /api/psp/configure — disconnect the PSP entirely (session-gated).
 * Wipes the stored credentials from the database; the app immediately falls
 * back to clearly-labeled demo mode.
 */
export async function DELETE(request: Request) {
  // P0-2: operator-only — ADMIN_TOKEN bearer in prod, demo session locally.
  if (!isAdminRequest(request)) return unauthorized();

  const limit = await rateLimit(request, "pspConfigure");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  await clearPspSettings();
  invalidateModeCache();
  const [status, mode] = await Promise.all([getPspStatus(), resolvePaymentMode()]);
  return NextResponse.json({
    cleared: true,
    status: { ...status, mode, webhookUrl: providerWebhookUrl("razorpay", request) },
  });
}
