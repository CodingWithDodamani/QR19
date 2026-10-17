# Deploying QR19 to Vercel (Prisma Postgres)

The repo stays SQLite for local dev. Deploys switch the Prisma datasource to
PostgreSQL automatically: `scripts/choose-prisma-provider.mjs` runs at
`npm install` (`postinstall`) and flips `provider` in `prisma/schema.prisma` to
`postgresql` **when `DATABASE_URL` is a `postgres*://` URL** — before
`prisma generate` emits the query engine. Local installs (no Postgres URL)
leave everything on SQLite and byte-unchanged.

## 1. Required Vercel environment variables

Set these in Vercel → Project → Settings → Environment Variables (Production):

| Key | Value |
|---|---|
| `DATABASE_URL` | Your Postgres connection string from Vercel (Postgres / Neon / Supabase). Must start with `postgres://` or `postgresql://`. |
| `SESSION_SECRET` | `openssl rand -hex 32` — long random string, ≥32 chars. |
| `PSP_ENCRYPTION_KEY` | `openssl rand -hex 32` — AES key for stored PSP credentials. |
| `ADMIN_TOKEN` | `openssl rand -hex 32` — operator gate for the PSP console + staff overrides. Production refuses to boot without these three (`src/lib/env.ts`). |

Recommended:

| Key | Value |
|---|---|
| `REDIS_URL` | Upstash Redis URL. Without it the SSE bus + rate limiters fall back to single-instance in-memory — fine to try, wrong for real traffic. |
| `WHATSAPP_ALERTS` (`demo`/`live`) + `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` | Only when enabling paid-alerts on WhatsApp (`.env.example` documents the full set). |

## 2. Create the tables (one time)

Run locally, pointing `DATABASE_URL` at the hosted database (replace the URL):

```bash
# PowerShell
$env:DATABASE_URL = "postgres://user:pass@host/db?schema=public"
npm run db:push:postgres   # flips schema to postgresql → prisma db push → back to sqlite
```

Or with the Vercel CLI instead of pasting the URL:

```bash
npx vercel link && npx vercel env pull .vercel/.env.development --environment=production
npx dotenv -e .vercel/.env.development -- npm run db:push:postgres
```

The push creates the existing tables (`PaymentQueue`, `PaymentOrder`,
`WebhookEvent`, …) in the hosted DB — the same schema, provider-neutral.

## 3. Deploy

Push to `main` (or `npx vercel --prod`). Build command stays `npm run build`.
Verify the deploy log shows `[prisma-provider] datasource provider: sqlite ->
postgresql` during install — if the URL is missing or not `postgres*`, the
build bails to SQLite and the runtime will fail; fix the env var and redeploy.

## 4. Honest limits on serverless

- **SQLite never works in the deployed runtime** — only Postgres.
- **Single-instance fallbacks** (`event-bus.ts`, `rate-limit.ts`) are per
  lambda; set `REDIS_URL` (the Redis bus already fans out over pub/sub and
  shares limits atomically across instances).
- **SSE** streams per lambda with heartbeats; the client reconnects when a
  lambda ends, using the persisted queue state — it works, but long-lived
  hosting (Railway/Render) is smoother for the live payment display.
- Secrets are never logged or returned; `psp/status` stays masked-only.
