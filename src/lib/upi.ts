/**
 * QR19 core logic — amounts are represented as integer paise.
 *
 * Each generated QR code carries at most ₹1,999 (199900 paise), up to
 * 100 QR codes in total, i.e. a maximum collectible amount of ₹1,99,900.
 */

export const MAX_PAISE_PER_QR = 199900;
export const MAX_TOTAL_PAISE = 19990000; // ₹1,99,900

/**
 * Parse a decimal amount string ("4500", "4500.5", "4500.50") into paise.
 * Throws Error with a user-facing message when invalid.
 */
export function parseAmountToPaise(amount: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) {
    throw new Error("Enter an amount with up to two decimal places.");
  }

  const [rupees, paisePart = ""] = amount.trim().split(".");
  const paise = Number(rupees) * 100 + Number(paisePart.padEnd(2, "0"));

  if (!Number.isSafeInteger(paise) || paise < 1) {
    throw new Error("Enter an amount greater than ₹0.");
  }

  if (paise > MAX_TOTAL_PAISE) {
    throw new Error("Enter ₹1,99,900 or less (up to 100 QR codes).");
  }

  return paise;
}

/**
 * Split a total (paise) into QR-sized chunks of at most ₹1,999 each.
 * Returns the chunk amounts in paise, ordered largest-first.
 */
export function splitIntoPayments(totalPaise: number): number[] {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 1 || totalPaise > MAX_TOTAL_PAISE) {
    throw new Error("Invalid total amount.");
  }

  return Array.from(
    { length: Math.ceil(totalPaise / MAX_PAISE_PER_QR) },
    (_, index) => Math.min(MAX_PAISE_PER_QR, totalPaise - index * MAX_PAISE_PER_QR)
  );
}

/**
 * Split a total (paise) into QR-sized chunks where EVERY chunk amount is
 * different (anti-scam "unique amounts" mode).
 *
 * Why: when several QRs share the same amount (e.g. ₹1,999 + ₹1,999), a
 * dishonest customer can show one genuine "payment done" screenshot against
 * more than one code and the amounts alone cannot disprove it. With unique
 * amounts the amount that lands in the merchant's account identifies exactly
 * which QR was paid — one proof can never cover two codes.
 *
 * Rules enforced: parts are strictly different by at least ₹1 (100 paise),
 * every part is at least ₹1 and at most ₹1,999, and the parts always sum to
 * exactly the total. Amounts are returned largest-first, mirroring
 * splitIntoPayments.
 */
export const MIN_UNIQUE_PART_PAISE = 100; // ₹1
export const MIN_UNIQUE_GAP_PAISE = 100; // ₹1 between amounts
/** Largest total that still fits 100 different amounts of ≤ ₹1,999. */
export const MAX_UNIQUE_TOTAL_PAISE =
  MAX_TOTAL_PAISE - MIN_UNIQUE_GAP_PAISE * ((100 * 99) / 2); // ₹1,94,450

function minSumUnique(parts: number): number {
  return (MIN_UNIQUE_PART_PAISE * parts * (parts + 1)) / 2;
}

function maxSumUnique(parts: number): number {
  return (
    parts * MAX_PAISE_PER_QR -
    MIN_UNIQUE_GAP_PAISE * ((parts * (parts - 1)) / 2)
  );
}

export function splitIntoUniquePayments(totalPaise: number): number[] {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 1 || totalPaise > MAX_TOTAL_PAISE) {
    throw new Error("Invalid total amount.");
  }

  if (totalPaise > MAX_UNIQUE_TOTAL_PAISE) {
    throw new Error(
      `Unique amounts need more than 100 QR codes for ${formatINR(totalPaise)} (max ${formatINR(
        MAX_UNIQUE_TOTAL_PAISE
      )} in this mode). Turn unique amounts off or collect in two rounds.`
    );
  }

  // Smallest part count that can express the total with distinct parts.
  let parts = Math.ceil(totalPaise / MAX_PAISE_PER_QR);
  while (
    parts < 100 &&
    (minSumUnique(parts) > totalPaise || maxSumUnique(parts) < totalPaise)
  ) {
    parts += 1;
  }

  // Greedy, largest first: take as much as the cap allows while always
  // leaving the minimum feasible sum for the remaining (strictly smaller,
  // gap-separated) parts.
  const amounts: number[] = [];
  let remaining = totalPaise;
  let cap = MAX_PAISE_PER_QR;

  for (let partsLeft = parts; partsLeft >= 1; partsLeft--) {
    const rest = partsLeft - 1;
    const take = Math.min(cap, remaining - minSumUnique(rest));
    amounts.push(take);
    remaining -= take;
    cap = take - MIN_UNIQUE_GAP_PAISE;
  }

  // Defensive verification — never return a wrong split.
  if (
    remaining !== 0 ||
    amounts.some((a) => a < MIN_UNIQUE_PART_PAISE || a > MAX_PAISE_PER_QR) ||
    amounts.some((a, i) => i > 0 && amounts[i - 1] - a < MIN_UNIQUE_GAP_PAISE)
  ) {
    throw new Error(
      "Unique amounts can't be built for this total. Turn the toggle off and split the usual way."
    );
  }

  return amounts;
}

/**
 * Sanitize free-form typing/pasting for the amount field: keep digits plus
 * a single decimal point with at most two places. Intermediate states like
 * "4500." stay editable — final validity is still decided by
 * `parseAmountToPaise` on submit. Pasted junk such as "₹4,500" becomes
 * "4500" instead of an error.
 */
export function sanitizeAmountInput(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned.slice(0, 12);
  const head = cleaned.slice(0, dot);
  const tail = cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  if (head === "") return tail === "" ? "." : `0.${tail}`;
  return `${head}.${tail}`.slice(0, 12);
}

/**
 * Build a UPI deep link for a single payment chunk.
 */
export function buildUpiLink(
  upiId: string,
  payeeName: string,
  amountPaise: number,
  note: string,
  txnRef: string
): string {
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    am: (amountPaise / 100).toFixed(2),
    cu: "INR",
    tr: txnRef,
  });

  if (note) {
    params.set("tn", note);
  }

  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
}

/**
 * Format a paise amount as Indian currency. Whole rupees render without
 * decimals ("₹4,500"), anything with paise renders two ("₹502.50").
 */
export function formatINR(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: paise % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}
