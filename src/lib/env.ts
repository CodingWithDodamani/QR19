/**
 * Production boot guard for secrets.
 *
 * Session signing (`SESSION_SECRET`, see upi-lookup/session.ts) and PSP
 * credential encryption (`PSP_ENCRYPTION_KEY`, see payment/psp-settings.ts)
 * silently fall back to PUBLIC demo keys when unset or short. That is fine
 * for local development, but in production it would mean forgeable sessions
 * and decryptable merchant secrets — so production refuses to boot without
 * real keys (fail closed).
 *
 * P0-2: `ADMIN_TOKEN` gates every operator endpoint (PSP configure, event
 * monitors, staff skip/cancel). Without it in production the console would
 * fall back to the demo session anyone can mint — so it is required too.
 *
 * This module is dependency-free on purpose: it runs inside
 * `src/instrumentation.ts` at server boot and inside unit tests.
 */

/** Minimum secret length enforced in production (256-bit string). */
export const MIN_PROD_SECRET_LENGTH = 32;

const PROD_KEYS = ["SESSION_SECRET", "PSP_ENCRYPTION_KEY", "ADMIN_TOKEN"] as const;

export interface EnvIssue {
  key: (typeof PROD_KEYS)[number];
  problem: "missing" | "too_short";
  minLength: number;
}

/** Pure check: which required production secrets are missing or too short. */
export function validateProductionEnv(
  env: Record<string, string | undefined>
): EnvIssue[] {
  const issues: EnvIssue[] = [];
  for (const key of PROD_KEYS) {
    const value = env[key]?.trim() ?? "";
    if (!value) {
      issues.push({ key, problem: "missing", minLength: MIN_PROD_SECRET_LENGTH });
    } else if (value.length < MIN_PROD_SECRET_LENGTH) {
      issues.push({ key, problem: "too_short", minLength: MIN_PROD_SECRET_LENGTH });
    }
  }
  return issues;
}

let warnedOnce = false;

/**
 * Fail-closed boot check. Throws in production when a required secret is
 * missing or short (so the server never serves with public demo keys).
 * Skipped during `next build` (NEXT_PHASE) — the check runs when the
 * server actually boots. In dev/test it warns once instead of throwing.
 */
export function assertProductionEnv(
  env: Record<string, string | undefined> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  warn: (message: string) => void = console.warn
): void {
  if (nodeEnv !== "production") {
    if (!warnedOnce) {
      warnedOnce = true;
      const issues = validateProductionEnv(env);
      if (issues.length > 0) {
        warn(
          `[qr19] using public demo fallback key(s) for ${issues.map((i) => i.key).join(", ")} — ` +
            `set real values (>=${MIN_PROD_SECRET_LENGTH} chars) before deploying; production refuses to boot without them.`
        );
      }
    }
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const issues = validateProductionEnv(env);
  if (issues.length > 0) {
    const detail = issues
      .map((i) =>
        i.problem === "missing"
          ? `${i.key} is not set`
          : `${i.key} is too short (need >=${i.minLength} chars)`
      )
      .join("; ");
    throw new Error(
      `[qr19] refusing to boot in production with insecure secrets: ${detail}. ` +
        `Set long random values (>=${MIN_PROD_SECRET_LENGTH} chars) — the public demo fallbacks must never serve real traffic.`
    );
  }
}
