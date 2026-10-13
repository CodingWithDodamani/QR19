import { describe, expect, it } from "vitest";

import {
  buildUpiLink,
  formatINR,
  MAX_PAISE_PER_QR,
  MAX_TOTAL_PAISE,
  MAX_UNIQUE_TOTAL_PAISE,
  parseAmountToPaise,
  sanitizeAmountInput,
  splitIntoPayments,
  splitIntoUniquePayments,
} from "./upi";

describe("parseAmountToPaise", () => {
  it("parses whole rupees and paise forms", () => {
    expect(parseAmountToPaise("4500")).toBe(450000);
    expect(parseAmountToPaise("4500.5")).toBe(450050);
    expect(parseAmountToPaise("4500.50")).toBe(450050);
    expect(parseAmountToPaise("0.01")).toBe(1);
    expect(parseAmountToPaise("199900")).toBe(MAX_TOTAL_PAISE);
  });

  it("rejects malformed, zero, negative and over-limit input", () => {
    for (const bad of ["", "abc", "12.345", "0", "0.00", "-5", "199900.01", "  "]) {
      expect(() => parseAmountToPaise(bad)).toThrow();
    }
  });
});

describe("splitIntoPayments", () => {
  it("keeps a single QR whole when it fits", () => {
    expect(splitIntoPayments(199900)).toEqual([199900]);
  });

  it("spills exactly the remainder into the next QR", () => {
    expect(splitIntoPayments(199901)).toEqual([199900, 1]);
  });

  it("splits a typical bill largest-first and preserves the sum", () => {
    const parts = splitIntoPayments(450000);
    expect(parts).toEqual([199900, 199900, 50200]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(450000);
    for (const part of parts) {
      expect(part).toBeGreaterThan(0);
      expect(part).toBeLessThanOrEqual(MAX_PAISE_PER_QR);
    }
  });

  it("rejects invalid totals", () => {
    for (const bad of [0, -1, MAX_TOTAL_PAISE + 1, 1.5, Number.NaN]) {
      expect(() => splitIntoPayments(bad)).toThrow();
    }
  });
});

describe("splitIntoUniquePayments", () => {
  it("returns a single part for small totals", () => {
    expect(splitIntoUniquePayments(50000)).toEqual([50000]);
  });

  it("makes every part different with at least ₹1 gap and an exact sum", () => {
    // 2×199900 cannot stay at 2 parts (max distinct sum is 399700), so this
    // exercises the part-count growth + greedy path.
    const parts = splitIntoUniquePayments(399800);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(399800);
    expect(new Set(parts).size).toBe(parts.length);
    for (let i = 0; i < parts.length; i++) {
      expect(parts[i]).toBeGreaterThanOrEqual(100);
      expect(parts[i]).toBeLessThanOrEqual(MAX_PAISE_PER_QR);
      if (i > 0) expect(parts[i - 1] - parts[i]).toBeGreaterThanOrEqual(100);
    }
  });

  it("holds the invariants on a multi-QR bill", () => {
    const total = 450000;
    const parts = splitIntoUniquePayments(total);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    expect(new Set(parts).size).toBe(parts.length);
    for (const part of parts) {
      expect(part).toBeGreaterThanOrEqual(100);
      expect(part).toBeLessThanOrEqual(MAX_PAISE_PER_QR);
    }
  });

  it("refuses totals that need more than 100 distinct amounts", () => {
    expect(() => splitIntoUniquePayments(MAX_UNIQUE_TOTAL_PAISE + 1)).toThrow();
    expect(() => splitIntoUniquePayments(MAX_TOTAL_PAISE)).toThrow();
  });
});

describe("collect-form input edges", () => {
  it("accepts padded, dotted and boundary-correct amounts", () => {
    expect(parseAmountToPaise("  4500  ")).toBe(450000);
    expect(parseAmountToPaise("00.50")).toBe(50);
    expect(parseAmountToPaise("1999")).toBe(199900);
    expect(parseAmountToPaise("199900")).toBe(MAX_TOTAL_PAISE);
  });

  it("rejects everything users actually mistype into the amount field", () => {
    const bad = [
      "", "   ", "abc", "₹500", "Rs.500", "4,500", "1,99,900",
      "4500.", ".5", "12.345", "0", "0.00", "-5", "5-0", "1e3",
      "0x10", "199900.01", "999999999999",
    ];
    for (const input of bad) {
      expect(() => parseAmountToPaise(input), JSON.stringify(input)).toThrow();
    }
  });

  it("accepts exactly what the server accepts as a UPI ID", () => {
    const ok = /^[a-zA-Z0-9._-]{2,60}@[a-zA-Z0-9.-]{2,60}$/;
    for (const id of ["name@okaxis", "a.bc@xy-bank", "ab@cd", "ramesh_01@okhdfcbank"]) {
      expect(ok.test(id), id).toBe(true);
    }
    for (const id of ["a@b", "@bank", "name@", "a b@c", "x".repeat(61) + "@bank", "name@" + "x".repeat(61), ""]) {
      expect(ok.test(id), JSON.stringify(id)).toBe(false);
    }
  });

  it("splits boundary totals so every QR stays payable", () => {
    expect(splitIntoPayments(1)).toEqual([1]);
    expect(splitIntoPayments(MAX_TOTAL_PAISE).length).toBe(100);
    const parts = splitIntoPayments(MAX_TOTAL_PAISE);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(MAX_TOTAL_PAISE);
    expect(Math.max(...parts)).toBeLessThanOrEqual(MAX_PAISE_PER_QR);
  });

  it("embeds trimmed merchant input into every QR link", () => {
    // CollectScreen trims before calling — the link layer must then carry
    // the exact values with no stray whitespace.
    const link = buildUpiLink("test@okaxis", "Test Shop", 199900, "Invoice 001", "ON99X01");
    expect(link).toContain("pa=test%40okaxis");
    expect(link).toContain("pn=Test%20Shop");
    expect(link).toContain("am=1999.00");
    expect(link).toContain("tn=Invoice%20001");
    expect(link).toContain("tr=ON99X01");
    expect(link).not.toContain("+");
    expect(link.startsWith("upi://pay?")).toBe(true);
  });
});

describe("sanitizeAmountInput", () => {
  it("strips everything except digits and one decimal point", () => {
    expect(sanitizeAmountInput("₹4,500")).toBe("4500");
    expect(sanitizeAmountInput("  500  ")).toBe("500");
    expect(sanitizeAmountInput("abc")).toBe("");
    expect(sanitizeAmountInput("12..34")).toBe("12.34");
    expect(sanitizeAmountInput("45.5.6")).toBe("45.56");
  });

  it("caps decimals at two places but keeps typing states editable", () => {
    expect(sanitizeAmountInput("45.555")).toBe("45.55");
    expect(sanitizeAmountInput("4500.")).toBe("4500.");
    expect(sanitizeAmountInput(".5")).toBe("0.5");
    expect(sanitizeAmountInput("500")).toBe("500");
  });

  it("sanitized pastes still parse to the intended paise", () => {
    expect(parseAmountToPaise(sanitizeAmountInput("₹4,500"))).toBe(450000);
    expect(parseAmountToPaise(sanitizeAmountInput("4500.50"))).toBe(450050);
    expect(parseAmountToPaise(sanitizeAmountInput(" 1999 "))).toBe(199900);
  });
});

describe("buildUpiLink", () => {
  it("encodes spaces as %20 (never +) and carries the order ref", () => {
    const link = buildUpiLink("test@okaxis", "Test Shop", 199900, "note here", "ON99X01");
    expect(link.startsWith("upi://pay?")).toBe(true);
    expect(link).not.toContain("+");
    expect(link).toContain("tn=note%20here");
    expect(link).toContain("tr=ON99X01");
    expect(link).toContain("am=1999.00");
    expect(link).toContain("cu=INR");
  });
});

describe("formatINR", () => {
  it("renders whole rupees without decimals and paise with two", () => {
    expect(formatINR(450000)).toBe("₹4,500");
    expect(formatINR(50250)).toBe("₹502.50");
  });
});
