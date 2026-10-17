/**
 * Prisma datasource provider chooser.
 *
 * Prisma 6 forbids `env()` inside the datasource `provider` (P1012), so this
 * script rewrites the single `provider = "<provider>"` line under
 * `datasource db` in prisma/schema.prisma:
 *
 * - `node scripts/choose-prisma-provider.mjs sqlite|postgresql` — explicit.
 * - No argument: resolves automatically for postinstall/test contexts —
 *   `PRISMA_PROVIDER` env wins, then DATABASE_URL (postgres* → postgresql,
 *   everything else → sqlite). Local dev and CI install get SQLite; a Vercel
 *   install with a Postgres DATABASE_URL flips to PostgreSQL BEFORE the
 *   explicit `prisma generate` (postinstall) runs, so the generated query
 *   engine always matches the runtime database.
 *
 * Idempotent: rewriting an already-correct provider leaves the file byte
 * unchanged, so local installs never dirty the git tree.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROVIDERS = new Set(["sqlite", "postgresql"]);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "prisma", "schema.prisma");

function resolveTarget() {
  const explicit = process.argv[2];
  if (explicit) {
    if (!PROVIDERS.has(explicit)) {
      console.error(`[prisma-provider] unknown provider "${explicit}" — use sqlite or postgresql.`);
      process.exit(1);
    }
    return explicit;
  }
  const envChoice = process.env.PRISMA_PROVIDER?.trim();
  if (envChoice && PROVIDERS.has(envChoice)) return envChoice;
  const url = process.env.DATABASE_URL?.trim() ?? "";
  return url.startsWith("postgres") ? "postgresql" : "sqlite";
}

const target = resolveTarget();
const schema = readFileSync(schemaPath, "utf8");

const blockStart = schema.indexOf("datasource db {");
const blockEnd = blockStart === -1 ? -1 : schema.indexOf("}", blockStart);
if (blockStart === -1 || blockEnd === -1) {
  console.error("[prisma-provider] datasource db block not found in prisma/schema.prisma.");
  process.exit(1);
}

const block = schema.slice(blockStart, blockEnd);
const current = /provider\s*=\s*"([a-z]+)"/.exec(block)?.[1];
if (!current) {
  console.error("[prisma-provider] no provider line found in the datasource db block.");
  process.exit(1);
}
if (current === target) {
  console.log(`[prisma-provider] datasource provider already "${current}" — no change.`);
  process.exit(0);
}

const patchedBlock = block.replace(/provider\s*=\s*"[a-z]+"/, `provider = "${target}"`);
writeFileSync(
  schemaPath,
  schema.slice(0, blockStart) + patchedBlock + schema.slice(blockEnd),
  "utf8"
);
console.log(`[prisma-provider] datasource provider: ${current} -> ${target} (prisma/schema.prisma).`);
