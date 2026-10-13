import { NextResponse } from "next/server";

import { publicOrigin } from "@/lib/payment/psp-auth";
import {
  getPspStatus,
  resolvePaymentMode,
} from "@/lib/payment/psp-settings";
import type { PspProvider } from "@/lib/payment/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/psp/status — non-secret view of the PSP console state.
 *
 * Returns which payment pipeline is active (demo / legacy-env live /
 * razorpay-test / razorpay-live / phonepe-test / phonepe-live /
 * paytm-test / paytm-live), a MASKED key id, the environment, whether a
 * webhook secret is configured, the last connection-test result, and the
 * webhook/callback URL to register in the active provider's dashboard.
 * Secrets never leave the server — this endpoint cannot leak them because
 * it never reads them.
 */

const PROVIDER_DOCS: Record<PspProvider, string> = {
  razorpay: "https://razorpay.com/docs/payments/qr-codes/",
  phonepe: "https://developer.phonepe.com/api",
  paytm: "https://developer.paytm.in/docs/",
};

export async function GET(request: Request) {
  const [status, mode] = await Promise.all([getPspStatus(), resolvePaymentMode()]);
  const provider: PspProvider = status.provider ?? "razorpay";
  return NextResponse.json(
    {
      ...status,
      mode,
      webhookUrl: `${publicOrigin(request)}/api/webhooks/${provider}`,
      providerDocs: PROVIDER_DOCS[provider],
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
