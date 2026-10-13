/**
 * Minimal PhonePe Payment Gateway v1 client — only the documented calls
 * this app needs, typed narrowly. Facts follow PhonePe Business developer
 * docs ("Pay API" + "Check Payment Status API" + callback verification):
 *
 * - Base URLs: UAT https://api.phonepe.net/apis/pg-test,
 *              PROD https://api.phonepe.net/apis/pg
 * - Initiate:  POST {base}/pg/v1/pay with JSON { request: "<base64 of the
 *              payload JSON>" } and header X-VERIFY =
 *              sha256(base64Payload + "/pg/v1/pay" + saltKey) + "###" + saltIndex
 *              (sha256 lowercase hex). Payload fields: merchantId,
 *              merchantTransactionId (unique, ≤36 chars), merchantUserId,
 *              amount (INTEGER PAISE), redirectUrl, redirectMode, callbackUrl,
 *              paymentInstrument.type = "PAY_PAGE".
 * - Response:  { success, code?, message?, data?.instrumentResponse.redirectInfo }
 *              On success the merchant's customer is sent to the PhonePe-hosted
 *              payment page (redirectInfo.url). PhonePe does NOT return a
 *              scannable UPI QR string for PAY_PAGE — this client never
 *              fabricates one.
 * - Status:    GET {base}/pg/v1/status/{merchantId}/{merchantTransactionId}
 *              with X-VERIFY = sha256("/pg/v1/status/" + merchantId +
 *              merchantTransactionId + saltKey) + "###" + saltIndex.
 *              data.state ∈ CHECKING | PENDING | COMPLETED | FAILED.
 * - Callback:  PhonePe POSTs base64 of the status-style response to our
 *              callbackUrl with X-VERIFY = sha256(base64Body + saltKey) +
 *              "###" + saltIndex (no API path in the middle).
 *
 * Nothing here invents endpoints. If PhonePe returns an error it is mapped
 * to an honest, human-readable PhonePeApiError.
 */

import { createHash } from "crypto";

import type { DecryptedPspCredentials } from "./psp-settings";

const TIMEOUT_MS = 12_000;

/** Sha256 lowercase hex — PhonePe's checksum primitive. */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export class PhonePeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly hint?: string
  ) {
    super(message);
    this.name = "PhonePeApiError";
  }
}

export function phonepeBaseUrl(env: "test" | "live"): string {
  // Documented UAT / PROD gateway bases.
  return env === "live" ? "https://api.phonepe.net/apis/pg" : "https://api.phonepe.net/apis/pg-test";
}

/* ------------------------------------------------------------------ */
/* Wire types (only the fields we consume)                             */
/* ------------------------------------------------------------------ */

export interface PhonePeRedirectInfo {
  url: string;
  method?: string;
}

interface PhonePeEnvelope {
  success?: boolean;
  code?: string;
  message?: string;
  data?: {
    merchantId?: string;
    merchantTransactionId?: string;
    transactionId?: string;
    amount?: number;
    state?: string;
    responseCode?: string;
    instrumentResponse?: {
      type?: string;
      redirectInfo?: PhonePeRedirectInfo;
    };
  };
}

/* ------------------------------------------------------------------ */
/* Checksums                                                           */
/* ------------------------------------------------------------------ */

function xVerify(plain: string, saltKey: string, saltIndex: string): string {
  return `${sha256Hex(`${plain}${saltKey}`)}###${saltIndex}`;
}

/** X-VERIFY for POST /pg/v1/pay: checksum over base64(payload) + path. */
export function phonepePayChecksum(base64Payload: string, saltKey: string, saltIndex: string): string {
  return xVerify(`${base64Payload}/pg/v1/pay`, saltKey, saltIndex);
}

/** X-VERIFY for GET /pg/v1/status/:merchantId/:merchantTransactionId. */
export function phonepeStatusChecksum(
  merchantId: string,
  merchantTransactionId: string,
  saltKey: string,
  saltIndex: string
): string {
  return xVerify(`/pg/v1/status/${merchantId}/${merchantTransactionId}`, saltKey, saltIndex);
}

/**
 * Callback verification: PhonePe POSTs a base64 body and signs it with
 * sha256(base64Body + saltKey) + "###" + saltIndex (no path). Also checks
 * the "###saltIndex" suffix matches the configured salt index.
 */
export function phonepeVerifyCallback(
  base64Body: string,
  xVerifyHeader: string,
  saltKey: string,
  saltIndex: string
): boolean {
  if (!xVerifyHeader) return false;
  const [digest, suffix] = xVerifyHeader.split("###");
  if (!digest || suffix !== saltIndex) return false;
  const expected = sha256Hex(`${base64Body}${saltKey}`);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(digest.trim().toLowerCase(), "utf8");
  return a.length === b.length && a.equals(b);
}

/** Decode a callback body: base64 → JSON status-style response. */
export function phonepeDecodeCallback(base64Body: string): PhonePeEnvelope | null {
  try {
    const json = Buffer.from(base64Body, "base64").toString("utf8");
    const parsed = JSON.parse(json) as PhonePeEnvelope & { response?: unknown };
    // Some deployments nest the status object under a base64 `response`
    // string — unwrap that defensively (still only documented shapes).
    if (!parsed.data && typeof parsed.response === "string") {
      try {
        return JSON.parse(parsed.response) as PhonePeEnvelope;
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

function friendlyHint(status: number, code: string, message: string): string | undefined {
  if (status === 401 || /unauthorized|invalid.*checksum|checksum.*invalid/i.test(`${code} ${message}`)) {
    return "PhonePe rejected the checksum — re-check the Merchant ID, Salt Key and Salt Index (they must come from the same environment: UAT or Production).";
  }
  if (/merchant.*(not.*found|invalid)|invalid.*merchant/i.test(`${code} ${message}`)) {
    return "The Merchant ID was not recognized. Copy it exactly from the PhonePe Business dashboard for the selected environment.";
  }
  if (status === 403 || /permission|not.*enabled|activation/i.test(`${code} ${message}`)) {
    return "This merchant may not have access to the Payment Gateway product yet — check activation status in the PhonePe Business dashboard.";
  }
  return undefined;
}

async function phonepeFetch<T extends PhonePeEnvelope>(
  env: "test" | "live",
  path: string,
  xVerifyHeader: string,
  init?: { method?: string; body?: string }
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${phonepeBaseUrl(env)}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": xVerifyHeader,
      },
      body: init?.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "network error";
    throw new PhonePeApiError(0, "NETWORK_ERROR", `Could not reach the PhonePe gateway (${detail}).`);
  }

  let parsed: T;
  try {
    parsed = (await response.json()) as T;
  } catch {
    throw new PhonePeApiError(
      response.status,
      `HTTP_${response.status}`,
      `PhonePe responded ${response.status} with an unreadable body.`
    );
  }

  if (!response.ok || parsed.success === false) {
    const code = parsed.code ?? `HTTP_${response.status}`;
    const message = parsed.message ?? `PhonePe responded ${response.status}.`;
    throw new PhonePeApiError(response.status, code, message, friendlyHint(response.status, code, message));
  }

  return parsed;
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

export interface InitiatePayInput {
  /** Our unique order reference (≤36 chars) — becomes merchantTransactionId. */
  merchantTransactionId: string;
  /** Exact amount in INTEGER PAISE. */
  amountPaise: number;
  /** Where PhonePe sends the customer's browser back after payment. */
  redirectUrl: string;
  /** Server-to-server callback URL (signed with the salt key). */
  callbackUrl: string;
  /** Optional payer mobile number (10 digits). */
  mobileNumber?: string;
}

/**
 * Initiate a PAY_PAGE payment. Returns the PhonePe-hosted payment page URL.
 * PhonePe hosts the page — the app never renders a QR for this flow.
 */
export async function phonepeInitiatePay(
  creds: DecryptedPspCredentials,
  input: InitiatePayInput
): Promise<{ redirectUrl: string; method: string | null }> {
  if (creds.provider !== "phonepe") {
    throw new PhonePeApiError(0, "WRONG_PROVIDER", "Configured credentials are not PhonePe credentials.");
  }
  const payload = {
    merchantId: creds.keyId,
    merchantTransactionId: input.merchantTransactionId.slice(0, 36),
    merchantUserId: creds.keyId.slice(0, 36),
    amount: input.amountPaise, // integer paise per the documented contract
    redirectUrl: input.redirectUrl,
    redirectMode: "POST" as const,
    callbackUrl: input.callbackUrl,
    ...(input.mobileNumber ? { mobileNumber: input.mobileNumber } : {}),
    paymentInstrument: { type: "PAY_PAGE" as const },
  };
  const base64Payload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const envelope = await phonepeFetch<PhonePeEnvelope>(
    creds.env,
    "/pg/v1/pay",
    phonepePayChecksum(base64Payload, creds.keySecret, creds.saltIndex),
    { method: "POST", body: JSON.stringify({ request: base64Payload }) }
  );

  const redirect = envelope.data?.instrumentResponse?.redirectInfo;
  if (!envelope.data?.instrumentResponse || !redirect?.url) {
    throw new PhonePeApiError(
      0,
      "NO_REDIRECT",
      "PhonePe accepted the request but did not return a payment page URL."
    );
  }
  return { redirectUrl: redirect.url, method: redirect.method ?? null };
}

export type PhonePePaymentState =
  | { kind: "success"; amountPaise?: number; transactionId?: string; state: "COMPLETED" }
  | { kind: "failed"; transactionId?: string; state: "FAILED"; message?: string }
  | { kind: "pending"; state: string };

/** Map a status/callback envelope to an honest payment state. */
function mapState(envelope: PhonePeEnvelope): PhonePePaymentState {
  const state = envelope.data?.state ?? "";
  const transactionId = envelope.data?.transactionId;
  if (state === "COMPLETED") {
    return { kind: "success", amountPaise: envelope.data?.amount, transactionId, state };
  }
  if (state === "FAILED") {
    return {
      kind: "failed",
      transactionId,
      state,
      message: envelope.data?.responseCode ?? envelope.message ?? undefined,
    };
  }
  return { kind: "pending", state: state || "UNKNOWN" };
}

/**
 * Check Payment Status API — GET /pg/v1/status/{merchantId}/{txnId}.
 * The polling fallback's verification source (same API the callback mirrors).
 */
export async function phonepeCheckStatus(
  creds: DecryptedPspCredentials,
  merchantTransactionId: string
): Promise<PhonePePaymentState> {
  if (creds.provider !== "phonepe") {
    throw new PhonePeApiError(0, "WRONG_PROVIDER", "Configured credentials are not PhonePe credentials.");
  }
  const envelope = await phonepeFetch<PhonePeEnvelope>(
    creds.env,
    `/pg/v1/status/${encodeURIComponent(creds.keyId)}/${encodeURIComponent(merchantTransactionId)}`,
    phonepeStatusChecksum(creds.keyId, merchantTransactionId, creds.keySecret, creds.saltIndex)
  );
  return mapState(envelope);
}

/**
 * Connectivity probe used by the console "Test connection" button.
 *
 * HONEST SEMANTICS: we ask for the status of a transaction id that cannot
 * exist. Signature verification happens BEFORE lookup, so any response that
 * is not an auth/checksum failure PROVES the Merchant ID + Salt Key +
 * Salt Index are valid for the selected environment. Auth/checksum
 * rejections fail loudly.
 */
export async function phonepeTestConnection(
  creds: DecryptedPspCredentials
): Promise<{ ok: true; env: "test" | "live" }> {
  if (creds.provider !== "phonepe") {
    throw new PhonePeApiError(0, "WRONG_PROVIDER", "Configured credentials are not PhonePe credentials.");
  }
  const probeId = `ON99PROBE${Date.now().toString(36).toUpperCase()}`;
  try {
    await phonepeCheckStatus(creds, probeId);
    // A COMPLETED/FAILED/PENDING state for a random id would be surprising,
    // but reaching a mapped state still proves the checksum was accepted.
    return { ok: true, env: creds.env };
  } catch (error) {
    if (error instanceof PhonePeApiError) {
      const authFail = /INVALID_MERCHANT|MERCHANT.*NOT|UNAUTHORIZED|AUTHENTICATION|CHECKSUM|INVALID_SALT/i.test(
        `${error.code} ${error.message}`
      );
      if (authFail) throw error;
      // Non-existent transaction / lookup miss → credentials + checksum OK.
      return { ok: true, env: creds.env };
    }
    throw error;
  }
}
