/**
 * Indian mobile number + UPI ID handling for recipient discovery.
 *
 * Important (kept honest on purpose):
 * - A VALID UPI ID FORMAT does NOT mean the account exists. Only the payer's
 *   bank verifies account existence at payment time.
 * - A mobile number is NOT automatically a UPI alias. Number → VPA resolution
 *   ("UPI Number") is a provider capability that must be confirmed with the
 *   PSP/bank before any live lookup is attempted.
 */

export type NormalizeResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Normalize an Indian mobile number as typed by a user:
 * "98765 43210", "+919876543210", "0 98765-43210" → "9876543210".
 */
export function normalizeIndianMobile(raw: unknown): NormalizeResult {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "Enter a mobile number." };
  }

  let value = raw.trim().replace(/[\s\-().]/g, "");

  // Strip common prefixes: +91 / 91 (country), leading 0 (trunk).
  if (/^\+91\d{10}$/.test(value)) value = value.slice(3);
  else if (/^91\d{10}$/.test(value)) value = value.slice(2);
  else if (/^0\d{10}$/.test(value)) value = value.slice(1);

  if (!/^\d{10}$/.test(value)) {
    return { ok: false, error: "Enter a 10-digit Indian mobile number." };
  }
  if (!/^[6-9]/.test(value)) {
    return { ok: false, error: "Indian mobile numbers start with 6, 7, 8 or 9." };
  }

  return { ok: true, value };
}

/** Group a normalized number for display: 98765 43210. */
export function formatMobileDisplay(phone10: string): string {
  return `${phone10.slice(0, 5)} ${phone10.slice(5)}`;
}

/** Mask for any UI/log surface that must not show the full number. */
export function maskPhone(phone10: string): string {
  return `••••• ${phone10.slice(-4)}`;
}

/**
 * Mask a UPI ID for display when showing the full VPA is unnecessary:
 * "ashasharma@upidemo" → "as••••@upidemo".
 */
export function maskUpiId(upiId: string): string {
  const at = upiId.lastIndexOf("@");
  if (at < 1) return "••••";
  const local = upiId.slice(0, at);
  const domain = upiId.slice(at + 1);
  const head = local.slice(0, 2);
  const dots = "•".repeat(Math.max(3, Math.min(5, Math.max(0, local.length - 2))));
  return `${head}${dots}@${domain}`;
}

/** NPCI-style VPA format check: localPart@handle (letters first in handle). */
export function isValidUpiIdFormat(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const value = raw.trim();
  if (value.length < 3 || value.length > 320) return false;
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9.\-_]{0,254})@(?:[a-zA-Z][a-zA-Z0-9.\-_]{0,62})$/.test(value);
}

/** Lower-case trim; VPAs are case-insensitive in practice. */
export function normalizeUpiId(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Extract the payee VPA (+ optional name) from a UPI QR payload.
 * Handles `upi://pay?pa=...&pn=...` (and other app-specific schemes that
 * carry the same params). Returns null when the payload is not a UPI QR.
 */
export function parseUpiQrPayload(
  text: string
): { pa: string; pn?: string } | null {
  const value = text.trim();
  if (!value || value.length > 2048) return null;

  const params = new URLSearchParams();
  const schemeMatch = /^[a-z][a-z0-9+.-]*:/i.exec(value);
  if (schemeMatch) {
    const rest = value.slice(schemeMatch[0].length);
    const queryStart = rest.indexOf("?");
    if (queryStart === -1) return null;
    for (const [key, val] of new URLSearchParams(rest.slice(queryStart + 1))) {
      params.append(key, val);
    }
  } else if (value.includes("pa=")) {
    // Some gateways print bare query strings.
    for (const [key, val] of new URLSearchParams(value)) {
      params.append(key, val);
    }
  } else {
    return null;
  }

  const pa = params.get("pa");
  if (!pa || !isValidUpiIdFormat(pa)) return null;
  const pn = params.get("pn") ?? undefined;
  return { pa: pa.trim(), pn: pn?.trim() || undefined };
}
