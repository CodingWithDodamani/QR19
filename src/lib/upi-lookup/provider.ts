/**
 * Recipient-discovery provider layer.
 *
 * THE HONEST PART (requirement #1 and #5):
 * ---------------------------------------------------------------------
 * There is NO live provider configured in this environment. Mobile-number →
 * UPI handle resolution ("UPI Number" / alias resolution) is a regulated
 * capability that only your sponsoring bank / PSP can expose, through their
 * documented, approved API, after merchant onboarding and consent review.
 *
 * Therefore this file ships exactly two implementations:
 *  1. `demoProvider` — synthetic, clearly-labeled test directory. It never
 *     invents a match for an arbitrary number; unknown numbers are "not
 *     found". It exists so the UI, gating, rate limits and error states can
 *     be exercised end-to-end.
 *  2. `liveProvider` — a fail-closed placeholder. It reports that mobile
 *     lookup is UNSUPPORTED until a real PSP adapter is implemented. It does
 *     NOT guess VPAs, does NOT generate likely IDs, and never pretends a
 *     mock is real.
 */

export type LookupOutcome =
  | { kind: "found"; payeeName: string; upiId: string; recipientToken: string }
  | { kind: "not_found" };

export class ProviderUnavailableError extends Error {
  readonly retryable: boolean;
  constructor(message = "Recipient lookup provider is temporarily unavailable.") {
    super(message);
    this.name = "ProviderUnavailableError";
    this.retryable = true;
  }
}

export interface UpiLookupProvider {
  /** "demo" results are synthetic; "live" results come from a real PSP. */
  readonly mode: "demo" | "live";
  /** Whether THIS provider supports mobile-number → UPI resolution. */
  readonly supportsMobileLookup: boolean;
  /** When unsupported: what is missing, in plain language. */
  readonly unsupportedReason: string | null;
  /**
   * Resolve a normalized 10-digit Indian mobile number.
   * Must throw ProviderUnavailableError on outage, never fabricate a match.
   */
  lookup(phone10: string): Promise<LookupOutcome>;
}

/* ------------------------------------------------------------------ */
/* DEMO provider — synthetic directory (labeled everywhere in the UI)  */
/* ------------------------------------------------------------------ */

/**
 * Fixed allow-list of synthetic recipients. Numbers outside this list are
 * "not found" — the demo must not look like it can resolve real people.
 */
export const DEMO_DIRECTORY: Record<string, { name: string; upiId: string }> = {
  "9999900001": { name: "Asha Sharma", upiId: "asha.sharma901@upidemo" },
  "9999900002": { name: "Rahul Verma", upiId: "rahul.verma902@upidemo" },
  "9999900003": { name: "Priya Iyer", upiId: "priya.iyer903@upidemo" },
  "9999900004": { name: "Karthik Menon", upiId: "karthik.m904@upidemo" },
  "9999900005": { name: "Meera Nair", upiId: "meera.nair905@upidemo" },
};

/** Directory number that simulates a provider outage (tests the 503 path). */
export const DEMO_FAILURE_NUMBER = "9999900009";

export const DEMO_TEST_NUMBERS = Object.keys(DEMO_DIRECTORY).map(
  (phone) => `${phone.slice(0, 5)} ${phone.slice(5)}`
);

import crypto from "crypto";

const demoProvider: UpiLookupProvider = {
  mode: "demo",
  supportsMobileLookup: true,
  unsupportedReason: null,
  async lookup(phone10) {
    // A short, jittered delay so loading states are realistic.
    await new Promise((resolve) => setTimeout(resolve, 350 + Math.random() * 350));

    if (phone10 === DEMO_FAILURE_NUMBER) {
      throw new ProviderUnavailableError("Simulated provider outage (demo test number).");
    }

    const hit = DEMO_DIRECTORY[phone10];
    if (!hit) return { kind: "not_found" };

    // Opaque, deterministic recipient token — what a PSP would return instead
    // of a raw VPA when full handle disclosure is not permitted.
    const token = crypto.createHash("sha256").update(`demo:${phone10}`).digest("hex").slice(0, 18);
    return {
      kind: "found",
      payeeName: hit.name,
      upiId: hit.upiId,
      recipientToken: `rt_demo_${token}`,
    };
  },
};

/* ------------------------------------------------------------------ */
/* LIVE provider — fail-closed placeholder (no PSP configured)         */
/* ------------------------------------------------------------------ */

const liveProvider: UpiLookupProvider = {
  mode: "live",
  supportsMobileLookup: false,
  unsupportedReason:
    "No PSP adapter is configured for mobile-number (UPI Number) resolution. " +
    "A live lookup requires an approved PSP/bank API, merchant credentials and " +
    "consent setup — see docs/upi-recipient-discovery.md §5.",
  async lookup() {
    // Fail closed: never fake a result in live mode.
    throw new ProviderUnavailableError("Live recipient lookup is not configured.");
  },
};

export function getLookupProvider(): UpiLookupProvider {
  return process.env.UPI_LOOKUP_MODE?.trim().toLowerCase() === "live"
    ? liveProvider
    : demoProvider;
}
