import { assertProductionEnv } from "./lib/env";

/**
 * Runs once when the server runtime boots (`next dev` / `next start`) —
 * before any route handles traffic. Fail-closed secret check lives in
 * `src/lib/env.ts` (unit-tested); this hook only invokes it.
 */
export async function register(): Promise<void> {
  assertProductionEnv();
}
