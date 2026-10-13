import { describe, expect, it, vi } from "vitest";

import {
  assertProductionEnv,
  MIN_PROD_SECRET_LENGTH,
  validateProductionEnv,
} from "./env";

const LONG = "a".repeat(MIN_PROD_SECRET_LENGTH);

describe("validateProductionEnv", () => {
  it("reports both keys when missing", () => {
    expect(validateProductionEnv({})).toEqual([
      { key: "SESSION_SECRET", problem: "missing", minLength: MIN_PROD_SECRET_LENGTH },
      { key: "PSP_ENCRYPTION_KEY", problem: "missing", minLength: MIN_PROD_SECRET_LENGTH },
    ]);
  });

  it("rejects short keys — including 16-31 chars the old code accepted", () => {
    const issues = validateProductionEnv({
      SESSION_SECRET: "sixteen-chars-xx",
      PSP_ENCRYPTION_KEY: "x".repeat(31),
    });
    expect(issues).toEqual([
      { key: "SESSION_SECRET", problem: "too_short", minLength: MIN_PROD_SECRET_LENGTH },
      { key: "PSP_ENCRYPTION_KEY", problem: "too_short", minLength: MIN_PROD_SECRET_LENGTH },
    ]);
  });

  it("treats whitespace-only as missing and trims before measuring", () => {
    expect(
      validateProductionEnv({ SESSION_SECRET: "   ", PSP_ENCRYPTION_KEY: LONG })
    ).toEqual([
      { key: "SESSION_SECRET", problem: "missing", minLength: MIN_PROD_SECRET_LENGTH },
    ]);
  });

  it("accepts exactly 32-char secrets", () => {
    expect(
      validateProductionEnv({ SESSION_SECRET: LONG, PSP_ENCRYPTION_KEY: LONG })
    ).toEqual([]);
  });
});

describe("assertProductionEnv", () => {
  it("throws in production when secrets are missing", () => {
    expect(() => assertProductionEnv({}, "production", () => undefined)).toThrow(
      /refusing to boot in production/
    );
  });

  it("throws in production when a secret is short", () => {
    expect(() =>
      assertProductionEnv(
        { SESSION_SECRET: LONG, PSP_ENCRYPTION_KEY: "short" },
        "production",
        () => undefined
      )
    ).toThrow(/PSP_ENCRYPTION_KEY is too short/);
  });

  it("passes in production with strong secrets", () => {
    expect(() =>
      assertProductionEnv(
        { SESSION_SECRET: LONG, PSP_ENCRYPTION_KEY: LONG },
        "production",
        () => undefined
      )
    ).not.toThrow();
  });

  it("skips the check while Next.js is building (check runs at boot)", () => {
    process.env.NEXT_PHASE = "phase-production-build";
    try {
      expect(() => assertProductionEnv({}, "production", () => undefined)).not.toThrow();
    } finally {
      delete process.env.NEXT_PHASE;
    }
  });

  it("never throws outside production (warns instead)", () => {
    const warn = vi.fn();
    expect(() => assertProductionEnv({}, "development", warn)).not.toThrow();
    expect(() => assertProductionEnv({}, "test", warn)).not.toThrow();
    expect(() => assertProductionEnv({}, undefined, warn)).not.toThrow();
  });
});
