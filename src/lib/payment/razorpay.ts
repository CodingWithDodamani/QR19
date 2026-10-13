/**
 * Minimal Razorpay API client — only the calls this app needs, typed
 * narrowly. All facts follow Razorpay's official documentation:
 * - Auth: HTTP Basic with key_id:key_secret (https://razorpay.com/docs/api/authentication/)
 * - QR Codes: POST /v1/payments/qr_codes with type=upi_qr, usage=single_use,
 *   fixed_amount=true, payment_amount in paise, close_by (unix seconds,
 *   max 2 hours for single_use), notes (max 15 pairs, echoed onto payments)
 *   → returns id (qr_...) + image_url.
 * - Payments on a QR: GET /v1/payments/qr_codes/:id/payments
 * - Connectivity probe: GET /v1/payments?count=1
 *
 * Nothing here invents endpoints. If Razorpay returns an error it is
 * mapped to an honest, human-readable RazorpayApiError.
 */

import type { DecryptedPspCredentials } from "./psp-settings";

const API_BASE = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 12_000;

/** Single-use QRs may live at most 2 hours (Razorpay silently overrides
 *  larger values — documented behavior). */
export const RZP_MAX_QR_TTL_SECS = 7200;

export class RazorpayApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly hint?: string
  ) {
    super(message);
    this.name = "RazorpayApiError";
  }
}

/* ------------------------------------------------------------------ */
/* Wire types (only the fields we consume)                             */
/* ------------------------------------------------------------------ */

export interface RazorpayQr {
  id: string;
  entity: string;
  status: "active" | "closed";
  image_url?: string;
  payment_amount?: number;
  fixed_amount?: boolean;
  payments_amount_received?: number;
  payments_count_received?: number;
  close_by?: number;
  close_reason?: "on_demand" | "paid" | null;
  notes?: Record<string, string>;
}

export interface RazorpayPayment {
  id: string;
  entity: string;
  amount: number;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  method?: string;
  captured?: boolean;
  vpa?: string;
  notes?: Record<string, string>;
  error_description?: string;
  created_at?: number;
}

interface RazorpayErrorBody {
  error?: { code?: string; description?: string; reason?: string };
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

function authHeader(creds: DecryptedPspCredentials): string {
  return `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}`;
}

function friendlyHint(status: number, code: string, description: string): string | undefined {
  if (status === 401) return "The key id / key secret pair was rejected. Re-check both values (test keys start with rzp_test_, live keys with rzp_live_).";
  if (status === 403) return "This key may not have access to the QR Codes product.";
  if (/qr.?code/i.test(description) && /activate|enable|not.*enabled|on.?demand/i.test(description)) {
    return "The QR Codes product is on-demand — enable it for your account in the Razorpay dashboard (or via your point of contact) and try again.";
  }
  if (code === "BAD_REQUEST_ERROR" && /close_by/i.test(description)) {
    return "Adjust the QR validity window — Razorpay caps single-use QR codes at 2 hours.";
  }
  return undefined;
}

async function razorpayFetch<T>(
  creds: DecryptedPspCredentials,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: authHeader(creds),
        "Content-Type": "application/json",
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "network error";
    throw new RazorpayApiError(0, "NETWORK_ERROR", `Could not reach api.razorpay.com (${detail}).`);
  }

  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    let description = `Razorpay responded ${response.status}.`;
    try {
      const body = (await response.json()) as RazorpayErrorBody;
      if (body.error?.code) code = body.error.code;
      if (body.error?.description) description = body.error.description;
    } catch {
      // keep defaults
    }
    throw new RazorpayApiError(response.status, code, description, friendlyHint(response.status, code, description));
  }

  return (await response.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

/** Cheap authenticated probe used by the console "Test connection" button. */
export async function razorpayTestConnection(
  creds: DecryptedPspCredentials
): Promise<{ ok: true; keyMode: "test" | "live" }> {
  await razorpayFetch<{ count?: number; items?: unknown[] }>(creds, "/payments?count=1");
  return { ok: true, keyMode: creds.keyId.startsWith("rzp_live_") ? "live" : "test" };
}

export interface CreateQrInput {
  /** Exact amount in paise (fixed_amount single-use QR). */
  amountPaise: number;
  /** Short label Razorpay shows in dashboards (max 255). */
  name: string;
  /** Optional description (max 255). */
  description?: string;
  /** Echoed onto payments — this is how webhooks are correlated. */
  notes: Record<string, string>;
  /** Absolute epoch seconds when the QR should auto-close. */
  closeByUnix: number;
}

export async function razorpayCreateQr(
  creds: DecryptedPspCredentials,
  input: CreateQrInput
): Promise<RazorpayQr> {
  return razorpayFetch<RazorpayQr>(creds, "/payments/qr_codes", {
    method: "POST",
    body: {
      type: "upi_qr",
      usage: "single_use",
      fixed_amount: true,
      payment_amount: input.amountPaise,
      name: input.name.slice(0, 255),
      description: input.description?.slice(0, 255),
      notes: input.notes,
      close_by: input.closeByUnix,
    },
  });
}

export async function razorpayFetchQrPayments(
  creds: DecryptedPspCredentials,
  qrId: string
): Promise<RazorpayPayment[]> {
  const data = await razorpayFetch<{ items: RazorpayPayment[] }>(
    creds,
    `/payments/qr_codes/${encodeURIComponent(qrId)}/payments?count=20`
  );
  return data.items ?? [];
}

/**
 * Fetch the QR image. Razorpay's `image_url` is a public short link; this
 * client-side-neutral fetch follows it. Returns null when the URL does not
 * yield an image (caller falls back to the authenticated API artwork route
 * or an honest error state).
 */
export async function razorpayFetchQrImage(
  creds: DecryptedPspCredentials,
  imageUrl: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
      redirect: "follow",
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.startsWith("image/")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return { bytes, contentType };
  } catch {
    return null;
  }
}
