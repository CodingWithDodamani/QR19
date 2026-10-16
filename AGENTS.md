# AGENTS.md — QR19

Sequential UPI collection: split bill into `≤₹1,999` QRs, show one at a time, advance only on server-verified provider event. Next.js 16 App Router + React 19 + Prisma (SQLite).

## Entrypoints

- Queue write-path (only place that sets `paid`): `src/lib/payment/service.ts` — `createQueue()`, `processProviderEvent()`, `ensureProviderQr()`, `pollCurrentOrderPayments()`
- Core split math: `src/lib/upi.ts` — paise ints, `splitIntoPayments()`, `splitIntoUniquePayments()`
- Mode/creds: `src/lib/payment/psp-settings.ts` — `resolvePaymentMode()`, AES-GCM in `psp-settings.ts:59-89`
- Types cross REST+SSE: `src/lib/payment/types.ts`; fraud ledger: `src/lib/payment/fraud.ts`
- API: `src/app/api/payment-queues/route.ts` (POST create), `src/app/api/payment-queues/[id]/events/route.ts` (SSE), `src/app/api/webhooks/{payment,razorpay,phonepe,paytm}/route.ts`
- WhatsApp alerts (opt-in): `src/lib/payment/whatsapp.ts` — env config + fire-and-forget `notifyPaid()`; wired ONLY at the `advance.count>0` paid transition in `service.ts`; operator endpoint `src/app/api/psp/whatsapp-test/route.ts` (GET masked status / POST real test, ADMIN-gated); console-added numbers `src/app/api/psp/whatsapp-recipients/route.ts` (GET/POST) + `[id]/route.ts` (DELETE) — stored in `WhatsappRecipient`, merged with the env list at send time
- UI: `src/components/qr19/qr-tool.tsx` (generator), `src/components/qr19/verified-payment-mode.tsx` (display), `src/components/landing/psp-console.tsx`, `src/app/page.tsx`
- Theme: `next-themes` system-default dark mode — `ThemeProvider` wraps layout, `ThemeToggle` in navbar, `.dark` tokens in `globals.css` (toggle is mount-gated for hydration safety)
- Schema: `prisma/schema.prisma`; docs truth: `docs/sequential-payments.md`, `docs/fraud-shield.md`, `docs/psp-console.md`

## Commands (order matters)

```bash
npm install            # or bun install (bun.lock exists)
cp .env.example .env   # DATABASE_URL=file:../db/custom.db — relative to prisma/, points at db/
npx prisma db push     # REQUIRED before dev; creates db/custom.db + client. Use bun run db:push if bun.
npm run dev            # next dev -p 3000 | tee dev.log → http://localhost:3000
npm test               # vitest run — 71 tests (upi splitters + processProviderEvent guards incl. concurrency/crash redelivery + whatsapp alert unit tests), isolated DB in node_modules/.cache, no dev-data pollution
npm run typecheck      # tsc --noEmit — must pass; build also type-checks (ignoreBuildErrors:false)
npm run lint           # eslint . — no-unused-vars/no-explicit-any are warn; errors fail CI
npm run build          # next build + manual cp of .next/static + public into .next/standalone/ — do not delete the cp step
```

- CI: `.github/workflows/ci.yml` (install → typecheck → lint → test → build). Manual E2E still via checklist: `docs/sequential-payments.md:179-210`, `docs/fraud-shield.md:87-97`.
- `next.config.ts` has `ignoreBuildErrors:false, reactStrictMode:true` — build catches types. Run `npm run typecheck` explicitly.
- DB scripts: `db:generate`, `db:migrate`, `db:reset` (`prisma migrate reset` — destructive). Prefer `db:push` locally.
- Rebuild download zip: `bash scripts/export-source.sh` (excludes `.env`, `db/custom.db`, logs).

## Env & modes

- `DATABASE_URL`, `SESSION_SECRET` (console session), `ADMIN_TOKEN` (operator gate for PSP mutations + monitors + staff overrides — required in prod, `openssl rand -hex 32`), `PSP_ENCRYPTION_KEY` (AES key; falls back to public demo key `psp-settings.ts:36-48` — set before storing live keys), `UPI_LOOKUP_MODE=demo|live` (live fails closed), `PAYMENT_MODE=live` + `PAYMENT_WEBHOOK_SECRET` (legacy generic webhook), `APP_ORIGIN` (PhonePe callbacks + webhook self-test).
- Effective mode `resolvePaymentMode()`: DB `PspSettings` creds → `razorpay-{test,live}|phonepe-{test,live}|paytm-{test,live}` else `live` if env secret set else `demo`. Cached 5s (`CACHE_TTL_MS`). Razorpay env derived from `rzp_live_` prefix.
- `demo`: simulator `POST .../simulate` enabled, webhooks 403. `razorpay-live` / live: simulate + webhook-test 403. Test QRs are not scannable by real UPI apps.
- Analytics: off unless `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set (`src/components/analytics.tsx` renders nothing otherwise — enabling it flips the no-tracking default, so update privacy copy when you do).
- Store badges: hidden unless `src/lib/store-links.ts` has a URL + `SHOW_STORE_BADGES=true` (PWA install is the channel until Play/App Store listings exist).
- WhatsApp paid alerts: off unless `WHATSAPP_ALERTS=demo|live` (`whatsapp.ts` — `demo` logs only/no network mirrors `UPI_LOOKUP_MODE`; `live` fails CLOSED if `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN`/no recipient is missing; template `payment_received` with 5 positional params amount, seq, total, provider, providerRef — see `.env.example`). Fire-and-forget at the single paid transition; send failures never touch the money path. Recipients = env `WHATSAPP_RECIPIENT` ∪ numbers added in the console card (stored in `WhatsappRecipient`, max 20, ADMIN-gated `whatsapp-recipients` API; mode stays env-driven). Console card: PSP console → "WhatsApp payment alerts" (masked, ADMIN-gated).

## Invariants (do not break)

- Amounts are integer paise. Limits: `MAX_PAISE_PER_QR=199900`, `MAX_TOTAL=19990000`, 100 orders (`src/lib/upi.ts:8`, `src/lib/payment/config.ts:46-48`). Unique-amounts mode: parts differ ≥₹1, uses `MIN_UNIQUE_*` + greedy in `upi.ts:106-116`.
- One `providerRef` verifies exactly one order (`service.ts:587-617` → `duplicate_txn_ref`). Exact amount match required (`amount_mismatch`). `paid` orders ignore repeats (`already_paid`). Unknown/stale successes are audit-only + `FraudAlert`, never progress.
- `WebhookEvent.id` = provider `eventId`; `P2002` = duplicate, ack + ignore. Never bypass `processProviderEvent()` — demo simulator uses same path.
- Queue pointer derived from order statuses (`recomputeQueue()`); `pending→displayed` promotion + expiry reap run on every state read + 25s SSE heartbeat (`events/route.ts:91-100`). Statuses: `pending|displayed|paid|expired|cancelled|failed|skipped`.
- PSP provisioning is lazy per displayed order via `ensureProviderQr()` with in-flight map + 45s error backoff; errors stored in `providerQrError` and shown — never fabricate a QR (esp. PhonePe PAY_PAGE → `paymentPageUrl` only).
- PSP console mutations (`configure`), monitors (`events`, `fraud-alerts`) and staff overrides (`override`, `cancel`) are ADMIN_TOKEN-gated (`psp-auth.ts:isAdminRequest` — Bearer timing-safe; demo session accepted in dev only, 401 in prod without token). `psp/status` stays public (masked only). Do NOT relax this gate.
- `@/*` → `./src/*` (`tsconfig.json:26-30`). `db.ts:10` logs every query in dev. Rate limits + SSE bus are in-memory (`rate-limit.ts`, `event-bus.ts`) — single instance only.

## Gotchas

- `db/custom.db` is git-ignored-by-export but created on first push; delete + `db:push` to reset locally.
- SSE client must replace whole state on each `state` frame; `serverTime` corrects expiry countdown skew.
- PSP console mutations are ADMIN_TOKEN-gated (P0-2) — do not expose publicly without the token set. Recipient-lookup demo session is dev convenience only.
- `pn`/`tn` encoding: `buildUpiLink()` replaces `+` with `%20`.

## Risks/Gaps → improvement plan

1. ~~Single-instance bus + limiter~~ DONE: `src/lib/payment/redis.ts` (`getRedis(purpose)` — two lazy node-redis connections `"bus"` + `"commands"`; gated on `REDIS_URL`). Bus (`event-bus.ts`) fans out over Redis pub/sub with an `origin` id so a publisher drops its own echo (no double delivery). Limiter (`rate-limit.ts`) runs an atomic Lua fixed-window (`INCR`+`PEXPIRE`) shared across instances; every route now `await`s it. Unset `REDIS_URL` — or Redis unreachable → 30s cooldown — falls back to pure in-memory (per-instance), so single-instance dev needs no Redis.
2. ~~`ignoreBuildErrors` + neutered ESLint~~ DONE: `ignoreBuildErrors:false` + `reactStrictMode:true` (`next.config.ts`), `no-unused-vars/no-explicit-any` as warn (`eslint.config.mjs`), `npm run typecheck` script + CI (`.github/workflows/ci.yml`: install → typecheck → lint → test → build).
3. ~~`db.ts` query logging everywhere~~ DONE: gated on `NODE_ENV=development` (`db.ts:10`); still open: Postgres datasource option for prod.
4. ~~Demo fallback encryption key + `SESSION_SECRET` unset~~ DONE: `src/lib/env.ts` (`validateProductionEnv`/`assertProductionEnv`, `MIN_PROD_SECRET_LENGTH=32`) enforced at boot via `src/instrumentation.ts` — throws in `NODE_ENV=production` (skipped for `next build`), warns once in dev; covered by `src/lib/env.test.ts`.
5. ~~No automated tests~~ → DONE: vitest (`npm test`, config `vitest.config.ts`, global-setup rebuilds isolated DB, `src/lib/upi.test.ts` + `src/lib/payment/service.guards.test.ts`); keep docs checklists as E2E.
6. PSP secrets in DB → document secret-manager migration path; enforce `PSP_ENCRYPTION_KEY>=32 chars` in prod.

## Local run TODO

- [ ] `npm install && cp .env.example .env && npx prisma db push`
- [ ] `npm run dev` → generate split at `/`, Start collecting, drive `.../simulate` (`success|wrong_amount|replayed_proof|duplicate_success`)
- [ ] `npm test` + `npx tsc --noEmit` + `npm run lint` clean
- [ ] Test webhook 401/duplicate paths per `docs/sequential-payments.md:179-210`
- [ ] Pick next improvement item above (suggest: 5, then 2, then 4)
