import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TEST_DATABASE_URL } from "./vitest.test-db";

/**
 * Vitest global setup: rebuild a fresh isolated SQLite DB before the suite.
 * Uses the same TEST_DATABASE_URL as the workers (see vitest.config.ts).
 * Runs `prisma db push` via node directly so it works with npm or bun.
 */
export default function setup(): void {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const cacheDir = path.resolve(root, "node_modules", ".cache");
  mkdirSync(cacheDir, { recursive: true });
  // TEST_DATABASE_URL is prisma-relative (../../ from prisma/); the file is
  // <root>/node_modules/.cache/vitest-test.db regardless of which form is used.
  for (const suffix of ["", "-journal"]) {
    try {
      rmSync(path.join(cacheDir, `vitest-test.db${suffix}`), { force: true });
    } catch {
      // ignore
    }
  }
  execFileSync(
    process.execPath,
    ["scripts/choose-prisma-provider.mjs", "sqlite"],
    // The isolated test DB is SQLite regardless of what a deploy env set
    // (e.g. a Postgres DATABASE_URL on Vercel pulled into local env files).
    { cwd: root, stdio: "inherit" }
  );
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--accept-data-loss", "--schema", "prisma/schema.prisma"],
    {
      cwd: root,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: "inherit",
    }
  );
}
