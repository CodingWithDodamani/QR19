import crypto from "crypto";

import { db } from "@/lib/db";

import type { PspProvider } from "./types";

/**
 * Merchant-configured PSP credentials (the thing that makes the PSP console
 * real). Stored in the database, encrypted at rest with AES-256-GCM; the
 * encryption key never leaves the server. The merchant secret (Razorpay key
 * secret / PhonePe salt key / Paytm merchant key) is treated like a password:
 * - never returned to any client (only masked previews),
 * - only ever used server-side to call the PSP API or verify callbacks,
 * - wipeable instantly from the console.
 *
 * HONEST LABEL: storing merchant API keys in the app database is standard
 * for self-hosted merchant tooling, but a production deployment should use
 * a dedicated secret manager and admin-only access (see docs/psp-console.md).
 */

const SINGLETON_ID = "singleton";
const CACHE_TTL_MS = 5_000;

export const PSP_PROVIDERS: PspProvider[] = ["razorpay", "phonepe", "paytm"];

export function isPspProvider(value: unknown): value is PspProvider {
  return value === "razorpay" || value === "phonepe" || value === "paytm";
}

/* ------------------------------------------------------------------ */
/* Encryption (AES-256-GCM, key derived via scrypt)                    */
/* ------------------------------------------------------------------ */

const ENC_VERSION = "v1";

function usingInsecureEncryptionKey(): boolean {
  const key = encryptionKeySource();
  return key === "one999-demo-only-insecure-psp-encryption";
}

function encryptionKeySource(): string {
  const explicit = process.env.PSP_ENCRYPTION_KEY?.trim();
  if (explicit && explicit.length >= 16) return explicit;
  const session = process.env.SESSION_SECRET?.trim();
  if (session && session.length >= 16) return session;
  // Dev/demo fallback — encryption still works, but the key is public.
  return "one999-demo-only-insecure-psp-encryption";
}

let cachedAesKey: Buffer | null = null;

function aesKey(): Buffer {
  if (!cachedAesKey) {
    cachedAesKey = crypto.scryptSync(encryptionKeySource(), "one999-psp-v1", 32);
  }
  return cachedAesKey;
}

function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENC_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function decryptSecret(encoded: string): string | null {
  try {
    const [version, ivPart, tagPart, dataPart] = encoded.split(".");
    if (version !== ENC_VERSION || !ivPart || !tagPart || !dataPart) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      aesKey(),
      Buffer.from(ivPart, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 8)}••••••••${value.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* Settings store                                                      */
/* ------------------------------------------------------------------ */

export interface DecryptedPspCredentials {
  /** Which PSP these credentials belong to. */
  provider: PspProvider;
  /** PhonePe/Paytm environment. Razorpay derives it from the keyId prefix. */
  env: "test" | "live";
  /** Razorpay key id | PhonePe merchantId | Paytm MID. */
  keyId: string;
  /** Razorpay key secret | PhonePe saltKey | Paytm merchantKey. */
  keySecret: string;
  /** Optional Razorpay webhook secret (PhonePe/Paytm verify via salt/key). */
  webhookSecret: string | null;
  /** PhonePe salt index — "0" or "1" (documented default "1"). */
  saltIndex: string;
}

interface CacheEntry {
  value: DecryptedPspCredentials | null;
  expiresAt: number;
}

const globalForPsp = globalThis as unknown as {
  __pspSettingsCache: CacheEntry | undefined;
};

function readCache(): CacheEntry | undefined {
  return globalForPsp.__pspSettingsCache;
}

function writeCache(value: DecryptedPspCredentials | null): void {
  globalForPsp.__pspSettingsCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
}

export function invalidatePspCache(): void {
  globalForPsp.__pspSettingsCache = undefined;
}

function parseExtraJson(raw: string | null): { saltIndex?: string } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.saltIndex === "string" ? { saltIndex: parsed.saltIndex } : {};
  } catch {
    return {};
  }
}

export async function getPspCredentials(): Promise<DecryptedPspCredentials | null> {
  const cached = readCache();
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const row = await db.pspSettings.findUnique({ where: { id: SINGLETON_ID } });
  if (!row || !row.enabled || !isPspProvider(row.provider) || !row.keyId || !row.keySecretEnc) {
    writeCache(null);
    return null;
  }
  const keySecret = decryptSecret(row.keySecretEnc);
  if (!keySecret) {
    // Fail-closed: an undecryptable secret must never half-configure a PSP.
    writeCache(null);
    return null;
  }

  const provider = row.provider;
  let env: "test" | "live";
  if (provider === "razorpay") {
    env = row.keyId.startsWith("rzp_live_") ? "live" : "test";
  } else {
    env = row.env === "live" ? "live" : "test";
  }

  const extras = parseExtraJson(row.extraJson);
  const saltIndex = provider === "phonepe" ? (extras.saltIndex === "0" ? "0" : "1") : "1";

  const value: DecryptedPspCredentials = {
    provider,
    env,
    keyId: row.keyId,
    keySecret,
    webhookSecret: row.webhookSecretEnc ? decryptSecret(row.webhookSecretEnc) : null,
    saltIndex,
  };
  writeCache(value);
  return value;
}

export interface SavePspInput {
  provider: PspProvider;
  /** "test" | "live" for phonepe/paytm (razorpay derives from keyId). */
  env?: "test" | "live";
  keyId: string;
  keySecret: string;
  webhookSecret?: string | null;
  /** PhonePe salt index ("0" | "1", default "1"). Stored in extraJson. */
  saltIndex?: string;
}

export async function savePspSettings(input: SavePspInput): Promise<void> {
  const keyId = input.keyId.trim();
  const keySecret = input.keySecret.trim();
  const webhookSecret = input.webhookSecret?.trim();
  const env =
    input.provider === "razorpay"
      ? keyId.startsWith("rzp_live_")
        ? "live"
        : "test"
      : input.env === "live"
        ? "live"
        : "test";
  const extraJson =
    input.provider === "phonepe" ? JSON.stringify({ saltIndex: input.saltIndex === "0" ? "0" : "1" }) : null;

  await db.pspSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      provider: input.provider,
      env,
      keyId,
      keySecretEnc: encryptSecret(keySecret),
      webhookSecretEnc: webhookSecret ? encryptSecret(webhookSecret) : null,
      extraJson,
      enabled: true,
    },
    update: {
      provider: input.provider,
      env,
      keyId,
      keySecretEnc: encryptSecret(keySecret),
      webhookSecretEnc: webhookSecret ? encryptSecret(webhookSecret) : null,
      extraJson,
      enabled: true,
      lastTestAt: null,
      lastTestOk: null,
      lastTestMessage: null,
    },
  });
  invalidatePspCache();
}

export async function saveWebhookSecretOnly(webhookSecret: string | null): Promise<void> {
  const row = await db.pspSettings.findUnique({ where: { id: SINGLETON_ID } });
  if (!row) return;
  await db.pspSettings.update({
    where: { id: SINGLETON_ID },
    data: {
      webhookSecretEnc: webhookSecret ? encryptSecret(webhookSecret) : null,
      lastTestAt: null,
      lastTestOk: null,
      lastTestMessage: null,
    },
  });
  invalidatePspCache();
}

export async function clearPspSettings(): Promise<void> {
  await db.pspSettings.deleteMany({ where: { id: SINGLETON_ID } });
  invalidatePspCache();
}

export async function recordConnectionTest(ok: boolean, message: string): Promise<void> {
  await db.pspSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      provider: "razorpay",
      enabled: false,
      lastTestAt: new Date(),
      lastTestOk: ok,
      lastTestMessage: message.slice(0, 300),
    },
    update: {
      lastTestAt: new Date(),
      lastTestOk: ok,
      lastTestMessage: message.slice(0, 300),
    },
  });
}

/** Non-secret view for the console UI. */
export interface PspStatusView {
  configured: boolean;
  provider: PspProvider | null;
  env: "test" | "live" | null;
  enabled: boolean;
  keyIdMasked: string | null;
  webhookSecretConfigured: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  usingInsecureEncryptionKey: boolean;
}

export async function getPspStatus(): Promise<PspStatusView> {
  const row = await db.pspSettings.findUnique({ where: { id: SINGLETON_ID } });
  if (!row) {
    return {
      configured: false,
      provider: null,
      env: null,
      enabled: false,
      keyIdMasked: null,
      webhookSecretConfigured: false,
      lastTestAt: null,
      lastTestOk: null,
      lastTestMessage: null,
      usingInsecureEncryptionKey: usingInsecureEncryptionKey(),
    };
  }
  const provider = isPspProvider(row.provider) ? row.provider : null;
  return {
    configured: Boolean(row.keyId && row.keySecretEnc),
    provider,
    env:
      provider === "razorpay"
        ? row.keyId?.startsWith("rzp_live_")
          ? "live"
          : "test"
        : row.env === "live"
          ? "live"
          : row.env === "test"
            ? "test"
            : null,
    enabled: row.enabled,
    keyIdMasked: row.keyId ? maskSecret(row.keyId) : null,
    webhookSecretConfigured: Boolean(row.webhookSecretEnc),
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastTestOk: row.lastTestOk,
    lastTestMessage: row.lastTestMessage,
    usingInsecureEncryptionKey: usingInsecureEncryptionKey(),
  };
}

/* ------------------------------------------------------------------ */
/* Effective payment mode                                              */
/* ------------------------------------------------------------------ */

let cachedMode: { value: PaymentModeValue; expiresAt: number } | null = null;

type PaymentModeValue =
  | "demo"
  | "live"
  | "razorpay-test"
  | "razorpay-live"
  | "phonepe-test"
  | "phonepe-live"
  | "paytm-test"
  | "paytm-live";

/**
 * The single source of truth for which payment pipeline is active:
 * 1. PSP credentials configured in the console (encrypted, enabled):
 *    - razorpay → "razorpay-live" for rzp_live_ keys, else "razorpay-test"
 *    - phonepe  → "phonepe-live" / "phonepe-test" (stored env)
 *    - paytm    → "paytm-live" / "paytm-test" (stored env)
 * 2. Legacy env mode: PAYMENT_MODE=live + PAYMENT_WEBHOOK_SECRET → "live".
 * 3. Otherwise demo.
 *
 * Fail-closed: a row whose secret cannot be decrypted falls back to demo
 * rather than half-configured operation.
 */
export async function resolvePaymentMode(): Promise<PaymentModeValue> {
  if (cachedMode && cachedMode.expiresAt > Date.now()) return cachedMode.value;

  let value: PaymentModeValue = "demo";
  const creds = await getPspCredentials();
  if (creds) {
    switch (creds.provider) {
      case "razorpay":
        value = creds.env === "live" ? "razorpay-live" : "razorpay-test";
        break;
      case "phonepe":
        value = creds.env === "live" ? "phonepe-live" : "phonepe-test";
        break;
      case "paytm":
        value = creds.env === "live" ? "paytm-live" : "paytm-test";
        break;
    }
  } else {
    const raw = (process.env.PAYMENT_MODE ?? "").trim().toLowerCase();
    if (raw === "live" && process.env.PAYMENT_WEBHOOK_SECRET) value = "live";
  }

  cachedMode = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function invalidateModeCache(): void {
  cachedMode = null;
}
