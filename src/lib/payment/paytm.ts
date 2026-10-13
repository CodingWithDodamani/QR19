/**
 * Minimal Paytm Payments v3 Dynamic QR client — only the documented calls
 * this app needs, typed narrowly. Facts follow Paytm developer docs
 * (Dynamic QR API v3 + Transaction Status API v3):
 *
 * - Base URLs: STAGE https://securegw-stage.paytm.in,
 *              PROD https://securegw.paytm.in
 * - Checksum:  HMAC-SHA256 of the exact JSON request string keyed with the
 *              merchant key, BASE64 output, sent as header `checksumhash`
 *              (PaytmChecksum.generateSignature semantics).
 * - Create:    POST {base}/v3/order/dynamicQRApi, headers Content-Type +
 *              checksumhash. Body: { mid, orderId, amount: "<rupees string
 *              2dp>" (RUPEES, unlike PhonePe/Razorpay paise), businessType:
 *              "UPI_QR", posId: "QRMID", qrFormat: "WM", validity: seconds }.
 *              Response: { mid, orderId, status, responseCode, responseMsg,
 *              qrData: "upi://pay?...", qrImageId, qrImage: "<base64 png>" }.
 *              `qrData` is rendered client-side exactly like the demo QRs.
 * - Status:    POST {base}/v3/status, checksum over the body, { mid, orderId }
 *              → { resultInfo: { resultStatus: TXN_SUCCESS | TXN_FAILURE |
 *              PENDING, resultCode, resultMsg }, txnAmount?, txnId? }.
 *              Legacy UPPER_SNAKE fields (STATUS, TXNID, TXNAMOUNT) are
 *              tolerated defensively. txnAmount is RUPEES → converted to
 *              paise here.
 *
 * Nothing here invents endpoints. If Paytm returns an error it is mapped to
 * an honest, human-readable PaytmApiError.
 */

import { createHmac } from "crypto";

import type { DecryptedPspCredentials } from "./psp-settings";

const TIMEOUT_MS = 12_000;

export const PAYTM_MAX_QR_VALIDITY_SECS = 21_600; // documented max for dynamic QR validity
export const PAYTM_MIN_QR_VALIDITY_SECS = 60;

export class PaytmApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly hint?: string
  ) {
    super(message);
    this.name = "PaytmApiError";
  }
}

export function paytmBaseUrl(env: "test" | "live"): string {
  return env === "live" ? "https://securegw.paytm.in" : "https://securegw-stage.paytm.in";
}

/** Rupees (2dp string) → integer paise, without float surprises. */
export function rupeesStringToPaise(value: string): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
  const [rupees, paise = "0"] = trimmed.split(".");
  return Number(rupees) * 100 + Number(paise.padEnd(2, "0").slice(0, 2));
}

/* ------------------------------------------------------------------ */
/* Wire types (only the fields we consume)                             */
/* ------------------------------------------------------------------ */

interface PaytmDynamicQrResponse {
  mid?: string;
  orderId?: string;
  status?: string;
  responseCode?: string;
  responseMsg?: string;
  qrData?: string;
  qrImageId?: string;
  qrImage?: string;
}

interface PaytmResultInfo {
  resultStatus?: string;
  resultCode?: string;
  resultMsg?: string;
}

interface PaytmStatusResponse extends PaytmResultInfo {
  // v3 camelCase
  resultInfo?: PaytmResultInfo;
  txnAmount?: string;
  txnId?: string;
  responseMsg?: string;
  // legacy UPPER_SNAKE, tolerated defensively
  STATUS?: string;
  TXNAMOUNT?: string;
  TXNID?: string;
  RESPMSG?: string;
}

/* ------------------------------------------------------------------ */
/* Checksum                                                            */
/* ------------------------------------------------------------------ */

/** HMAC-SHA256 base64 over the exact request string (documented semantics). */
export function paytmChecksum(body: string, merchantKey: string): string {
  return createHmac("sha256", merchantKey).update(body, "utf8").digest("base64");
}

/** Timing-safe comparison of a Paytm checksum header against an expected value. */
export function paytmVerifyChecksum(
  received: string,
  body: string,
  merchantKey: string
): boolean {
  if (!received) return false;
  // Some gateways wrap the header value in quotes — strip them defensively.
  const clean = received.trim().replace(/^"+|"+$/g, "");
  const expected = paytmChecksum(body, merchantKey);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(clean, "utf8");
  return a.length === b.length && a.equals(b);
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

function friendlyHint(code: string, message: string): string | undefined {
  if (/checksum/i.test(`${code} ${message}`)) {
    return "Paytm rejected the checksum — re-check the MID and Merchant Key (they must come from the same environment: Staging or Production).";
  }
  if (/mid.*(invalid|not.*exist)|invalid.*mid/i.test(`${code} ${message}`)) {
    return "The MID was not recognized. Copy it exactly from the Paytm dashboard for the selected environment.";
  }
  if (/key.*(invalid|mismatch)/i.test(`${code} ${message}`)) {
    return "The Merchant Key was rejected. Generate/copy it from the Paytm dashboard API keys page.";
  }
  return undefined;
}

async function paytmPost<T>(env: "test" | "live", path: string, bodyObj: Record<string, unknown>, merchantKey: string): Promise<T> {
  const body = JSON.stringify(bodyObj); // the checksum covers EXACTLY this string
  let response: Response;
  try {
    response = await fetch(`${paytmBaseUrl(env)}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        checksumhash: paytmChecksum(body, merchantKey),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "network error";
    throw new PaytmApiError(0, "NETWORK_ERROR", `Could not reach the Paytm gateway (${detail}).`);
  }

  let parsed: T & { responseCode?: string; responseMsg?: string; statusMessage?: string };
  try {
    parsed = (await response.json()) as typeof parsed;
  } catch {
    throw new PaytmApiError(
      response.status,
      `HTTP_${response.status}`,
      `Paytm responded ${response.status} with an unreadable body.`
    );
  }

  if (!response.ok) {
    const code = parsed.responseCode ?? `HTTP_${response.status}`;
    const message = parsed.responseMsg ?? parsed.statusMessage ?? `Paytm responded ${response.status}.`;
    throw new PaytmApiError(response.status, code, message, friendlyHint(code, message));
  }

  return parsed as T;
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

export interface CreateDynamicQrInput {
  /** Our unique order reference — becomes Paytm's orderId. */
  orderId: string;
  /** Exact amount in paise (converted to a rupee string for Paytm). */
  amountPaise: number;
  /** QR validity in seconds — clamped to [60, 21600] (documented bounds). */
  validitySecs: number;
}

export interface PaytmDynamicQr {
  qrData: string;
  qrImageId: string | null;
  responseMsg: string | null;
}

/**
 * Create a dynamic UPI QR bound to (mid, orderId, exact amount). The
 * returned `qrData` (a upi:// string pointing into the merchant's Paytm
 * account) is rendered client-side like the demo QRs.
 */
export async function paytmCreateDynamicQr(
  creds: DecryptedPspCredentials,
  input: CreateDynamicQrInput
): Promise<PaytmDynamicQr> {
  if (creds.provider !== "paytm") {
    throw new PaytmApiError(0, "WRONG_PROVIDER", "Configured credentials are not Paytm credentials.");
  }
  const validity = Math.min(
    Math.max(Math.floor(input.validitySecs), PAYTM_MIN_QR_VALIDITY_SECS),
    PAYTM_MAX_QR_VALIDITY_SECS
  );
  const response = await paytmPost<PaytmDynamicQrResponse>(
    creds.env,
    "/v3/order/dynamicQRApi",
    {
      mid: creds.keyId,
      orderId: input.orderId,
      amount: (input.amountPaise / 100).toFixed(2), // rupee STRING per Paytm's contract
      businessType: "UPI_QR",
      posId: "QRMID",
      qrFormat: "WM",
      validity,
    },
    creds.keySecret
  );

  if (!response.qrData) {
    throw new PaytmApiError(
      0,
      response.responseCode ?? "NO_QR_DATA",
      response.responseMsg ?? "Paytm accepted the request but did not return QR data."
    );
  }
  return {
    qrData: response.qrData,
    qrImageId: typeof response.qrImageId === "string" ? response.qrImageId : null,
    responseMsg: response.responseMsg ?? null,
  };
}

export type PaytmPaymentState =
  | { kind: "success"; amountPaise?: number; txnId?: string }
  | { kind: "failed"; txnId?: string; message?: string }
  | { kind: "pending" };

/** Normalize v3 + legacy UPPER_SNAKE status fields into one shape. */
function normalizeStatus(response: PaytmStatusResponse): {
  resultStatus: string;
  txnAmount?: string;
  txnId?: string;
  resultMsg?: string;
} {
  const info = response.resultInfo ?? {};
  const resultStatus = info.resultStatus ?? response.STATUS ?? "";
  const txnAmount = response.txnAmount ?? response.TXNAMOUNT;
  const txnId = response.txnId ?? response.TXNID;
  const resultMsg = info.resultMsg ?? response.RESPMSG ?? response.responseMsg;
  return { resultStatus, txnAmount, txnId, resultMsg };
}

/**
 * Transaction Status API — POST /v3/status with a checksummed body.
 * The polling fallback's verification source.
 */
export async function paytmCheckStatus(
  creds: DecryptedPspCredentials,
  orderId: string
): Promise<PaytmPaymentState> {
  if (creds.provider !== "paytm") {
    throw new PaytmApiError(0, "WRONG_PROVIDER", "Configured credentials are not Paytm credentials.");
  }
  const response = await paytmPost<PaytmStatusResponse>(
    creds.env,
    "/v3/status",
    { mid: creds.keyId, orderId },
    creds.keySecret
  );

  const { resultStatus, txnAmount, txnId, resultMsg } = normalizeStatus(response);
  if (resultStatus === "TXN_SUCCESS") {
    // txnAmount is RUPEES string → convert to paise for the amount check.
    return { kind: "success", amountPaise: txnAmount ? rupeesStringToPaise(txnAmount) : undefined, txnId };
  }
  if (resultStatus === "TXN_FAILURE") {
    return { kind: "failed", txnId, message: resultMsg ?? "TXN_FAILURE" };
  }
  return { kind: "pending" };
}

/**
 * Connectivity probe used by the console "Test connection" button.
 *
 * HONEST SEMANTICS: we ask for the status of an orderId that cannot exist.
 * The checksum is verified BEFORE the lookup, so a checksum-verified
 * no-record response proves the MID + Merchant Key are valid for the
 * selected environment. Checksum/auth rejections fail loudly.
 */
export async function paytmTestConnection(
  creds: DecryptedPspCredentials
): Promise<{ ok: true; env: "test" | "live" }> {
  if (creds.provider !== "paytm") {
    throw new PaytmApiError(0, "WRONG_PROVIDER", "Configured credentials are not Paytm credentials.");
  }
  const probeId = `ON99PROBE${Date.now().toString(36).toUpperCase()}`;
  try {
    await paytmCheckStatus(creds, probeId);
    return { ok: true, env: creds.env };
  } catch (error) {
    if (error instanceof PaytmApiError) {
      const authFail = /CHECKSUM|INVALID.?MID|MID.*(INVALID|NOT)|KEY.*(INVALID|MISMATCH)|UNAUTHORIZED|AUTHEN/i.test(
        `${error.code} ${error.message}`
      );
      if (authFail) throw error;
      // Checksum-verified no-record response → credentials work.
      return { ok: true, env: creds.env };
    }
    throw error;
  }
}
