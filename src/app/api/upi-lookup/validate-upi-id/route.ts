import { NextResponse, type NextRequest } from "next/server";

import { rateLimit } from "@/lib/payment/rate-limit";
import {
  isValidUpiIdFormat,
  normalizeUpiId,
} from "@/lib/upi-lookup/phone";
import { getSessionFromRequest } from "@/lib/upi-lookup/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/upi-lookup/validate-upi-id — FORMAT-ONLY validation of a UPI ID.
 *
 * Deliberately honest scope: this endpoint can only say whether the string is
 * a well-formed VPA (localPart@handle). It can NOT and does NOT check that
 * the account exists — only the payer's bank does that, at payment time.
 * (Requirement: do not confuse UPI ID validation with recipient resolution.)
 */

const FORMAT_NOTE =
  "Format check only — a valid format does not guarantee the account exists. Your bank verifies the recipient when you pay.";

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "unauthorized", message: "Sign in before validating a UPI ID." },
      { status: 401 }
    );
  }

  const limit = await rateLimit(request, "lookupValidate");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many checks. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSecs) } }
    );
  }

  let upiId: unknown;
  try {
    const body = (await request.json()) as { upiId?: unknown };
    upiId = body?.upiId;
  } catch {
    return NextResponse.json(
      { error: "invalid_input", message: "Invalid request body." },
      { status: 400 }
    );
  }

  if (typeof upiId !== "string" || !upiId.trim()) {
    return NextResponse.json(
      { valid: false, reason: "empty", message: "Enter a UPI ID (for example asha@upidemo)." },
      { status: 200 }
    );
  }

  if (!isValidUpiIdFormat(upiId)) {
    return NextResponse.json({
      valid: false,
      reason: "format",
      message: "That doesn't look like a UPI ID. Use the format name@bank — for example asha@upidemo.",
    });
  }

  return NextResponse.json({ valid: true, normalized: normalizeUpiId(upiId), message: FORMAT_NOTE });
}
