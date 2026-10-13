# Sequential QR Payments — Setup & Operations Guide

Server-verified sequential payment collection for QR19: after generating a
split, staff can open a one-at-a-time display screen. The paid QR swipes away
**only after the payment provider confirms the payment on the backend** — never
on a scan, a timer, or a local tap.

---

## 1. What is PRODUCTION vs DEMO vs UNVERIFIED (read this first)

| Capability | Status | Notes |
|---|---|---|
| Queue/order persistence, unique order IDs, expiry, statuses | **Production-quality** | SQLite + Prisma; schema in `prisma/schema.prisma` |
| Webhook endpoint with HMAC-SHA256 signature verification (timing-safe) | **Verified in E2E** | Tested: no/wrong signature → 401, valid → advance, replay → idempotent, wrong amount → blocked |
| Idempotent event processing (unique event ID ledger) | **Verified in E2E** | Duplicate deliveries return `handled:false, reason:"duplicate"` |
| Wrong/partial amount guard, out-of-order logging, expiry reap, audit trail | **Verified in E2E** | See §7 test checklist |
| Real-time push (SSE) + resync on reconnect/visibility | **Verified in E2E** | Display advanced with zero browser interaction; backgrounded tab resynced on return |
| DEMO simulator (`/simulate`) | **Demo-only** | Generates *synthetic* provider events through the same processor; disabled (403) in live mode; every screen labels it DEMO |
| Real money movement / real PSP connection | **NOT connected** | No PSP credentials exist in this environment. Nothing here collects money by itself — advances happen only when *your* PSP posts a verified webhook |
| UPI `upi://` deep links being revocable | **Not possible** | Raw intention links can't be cryptographically revoked after payment (see §5 mitigations) |

**Honest summary:** this app ships a complete, verified *payment orchestration
layer* (queue → order binding → verified-event-only advance → real-time
display). It does **not** ship a live PSP integration *out of the box*, because
none is configured. In DEMO mode, advances are simulated and clearly labeled.

> **UPDATE — real PSP console:** the app now includes a merchant-facing
> **Razorpay integration**. Saving Razorpay API keys in the landing page's
> "PSP console" section switches the app to `razorpay-test` / `razorpay-live`
> modes: real per-order QRs via Razorpay's QR Codes API, signed
> `qr_code.credited` webhooks, an API polling fallback, and a live event
> monitor. See **`docs/psp-console.md`** for the full guide, honest
> production-vs-demo-vs-unverified table, and test results. The
> provider-agnostic webhook contract below remains supported via
> `PAYMENT_MODE=live` + `PAYMENT_WEBHOOK_SECRET`.

---

## 2. Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | SQLite file (already configured) |
| `PAYMENT_MODE` | no | `live` to enable real webhook processing. Any other value → DEMO mode |
| `PAYMENT_WEBHOOK_SECRET` | **required for live** | Shared HMAC-SHA256 key with your PSP adapter. Live mode without it fails closed (stays DEMO); DEMO mode rejects all webhook bodies with 403 |

Mode selection logic (`src/lib/payment/config.ts`):
- `PAYMENT_MODE=live` **and** secret set → **live**
- anything else → **demo** (simulate endpoint enabled, webhook endpoint inert)

---

## 3. What a real PSP integration requires (do this before going live)

The app defines a provider-agnostic webhook contract. You need an adapter that
translates your PSP's webhook into this contract **and signs it**, or a PSP
whose webhook you verify directly.

### Required from the PSP
1. **Per-order payment creation** (server-side): create an order/intent for
   each QR's `orderId` so the PSP can enforce amount + single capture.
2. **Payment webhook** with per-delivery unique event ID and a signature
   (HMAC or certificate) covering the raw body.
3. **Order closure** on capture, so a paid order can never accept money again.

### The contract this app already implements
```
POST /api/webhooks/payment
Header: x-payment-signature: hex(hmac_sha256(raw_body, PAYMENT_WEBHOOK_SECRET))
Body:
{
  "eventId":     "evt_...",            // unique per delivery (idempotency key)
  "type":        "payment.success" | "payment.failed" | "order.terminated",
  "orderId":     "ON99XXXXXXXX01",     // our order reference (UPI `tr`)
  "amountPaise": 199900,               // must match the order exactly
  "providerRef": "pay_...",            // PSP transaction reference
  "reason":      "declined_by_bank",   // optional, failures only
  "terminal":    false                 // payment.failed only: PSP closed the order
}
```

### Concrete examples
- **Razorpay**: create Orders server-side (`amount` in paise, `receipt` =
  our `orderId`); subscribe to `payment.captured` / `payment.failed` webhooks;
  verify `x-razorpay-signature` (HMAC-SHA256 of raw body with your webhook
  secret) in a small adapter route, then re-emit our contract above.
- **PhonePe / Paytm / Cashfree**: same shape — order status callback + checksum
  verification → adapter → our contract.
- **NPCI intention-flow only (no PSP)**: cannot verify payment success. Do not
  connect it here — there is no webhook, so the queue would never advance
  legitimately.

**Adapter location:** create `src/app/api/webhooks/<psp>/route.ts`, verify the
PSP signature, map fields, forward to `processProviderEvent()` — never bypass
the idempotency ledger.

---

## 4. Architecture

```
Staff (browser)                     Backend (Next.js API + SQLite)              Display device (browser)
────────────────                    ──────────────────────────────              ────────────────────────
Generate split (on-device)
  │ POST /api/payment-queues ──────► create PaymentQueue + N PaymentOrder
  │   (idempotencyKey)                (orderId, qrPayload, expiry, status)
  │ ◄──────────────────────────────  queueId + initial state
  ▼
                            ┌─── GET /api/payment-queues/:id/events (SSE) ◄─── subscribe
                            │        • hello + full state snapshot
                            │        • state pushes on every change
                            │        • 25s heartbeat = expiry reaper
PSP ──► POST /api/webhooks/payment
        HMAC verify → WebhookEvent ledger (idempotent) → processProviderEvent()
        mark paid + advance pointer + audit ──► publish SSE ─────► swipe animation
                                                                   next QR appears
Staff overrides: skip/cancel (audited)   DEMO simulator: /simulate (demo mode only)
```

Key modules:
- `src/lib/payment/service.ts` — single write-path for all status changes
- `src/lib/payment/event-bus.ts` — in-process pub/sub (swap for Redis to scale out)
- `src/lib/payment/rate-limit.ts` — fixed-window per-IP limits
- `src/components/qr19/verified-payment-mode.tsx` — display screen (server-truth only)

### Statuses
`pending → displayed → paid | expired | cancelled | failed | skipped`
- Only `processProviderEvent` can set `paid` (webhook or demo — same code path).
- Staff `skip`/`cancel` are audited and **never** labeled paid.
- Expired orders are reaped on every state read + every SSE heartbeat.

### Queue endpoints
| Method | Path | Rate limit | Purpose |
|---|---|---|---|
| POST | `/api/payment-queues` | 10/min/IP | Create queue (idempotent by key) |
| GET | `/api/payment-queues/:id` | 240/min/IP | Authoritative snapshot (resync) |
| GET | `/api/payment-queues/:id/events` | — | SSE stream (hello/state/notice/ping) |
| POST | `/api/payment-queues/:id/orders/:orderId/override` | 30/min/IP | Staff skip/cancel order |
| POST | `/api/payment-queues/:id/cancel` | 30/min/IP | Staff cancel session |
| POST | `/api/payment-queues/:id/simulate` | 60/min/IP | **DEMO only** synthetic events |
| POST | `/api/webhooks/payment` | 300/min/IP | Live PSP webhook (HMAC) |

---

## 5. "Paid QR can't be paid again" — what is and isn't guaranteed

Guaranteed by this app:
- A paid order ignores further success events (`already_paid`) — no double
  counting, no double advance.
- The display screen never shows a paid/expired/cancelled QR again.
- All repeats are audit-logged and visible as notices.

Not possible with raw UPI deep links (honest limitation):
- The QR image itself cannot be "switched off" — if someone scans a printed
  paid QR later, the *bank* may still process an intention payment (it creates
  a brand-new transaction). Mitigations, in order of strength:
  1. **Production:** use PSP order APIs (Razorpay Orders etc.) so the PSP
     refuses payment against a captured order.
  2. Expiry: QRs carry a 15-min validity (configurable 60s–2h) and the UI
     countdown makes staleness visible.
  3. Reconciliation: every out-of-band success is audit-logged for manual refund.

---

## 6. Running

```bash
bun run db:push      # already applied
bun run dev          # http://localhost:3000
```

Staff flow: generate the split in the tool → **Start collecting** → the
one-at-a-time verified screen opens (DEMO badge in demo mode). The customer
pays the shown QR; when the PSP confirms, the card swipes away automatically.

---

## 7. Test checklist (all executed & passing in this environment)

Automated tests are replaced by this recorded E2E checklist (sandbox
convention: no test files). Re-run after any change:

| # | Scenario | Expected | Result |
|---|---|---|---|
| 1 | Create queue → state snapshot | orders, refs, `currentSeq:1`, mode | ✅ |
| 2 | Re-create with same idempotency key | same queue, `created:false` | ✅ |
| 3 | Invalid UPI / bad body | 400 | ✅ |
| 4 | Webhook body in demo mode | 403 (fail closed) | ✅ |
| 5 | SSE connect | `hello` + full `state` frame | ✅ |
| 6 | Wrong amount event | `amount_mismatch`, no advance, notice | ✅ |
| 7 | Declined event | QR stays, non-blocking notice | ✅ |
| 8 | Out-of-order success | recorded paid, pointer unchanged, audit + notice | ✅ |
| 9 | Success on current | `paid`, pointer advances, SSE push, UI swipe | ✅ |
| 10 | Replay same eventId / replay old success | `duplicate` / `already_paid` | ✅ |
| 11 | Staff skip with reason | `skipped` (never paid), advance, 2-step confirm | ✅ |
| 12 | Staff cancel session | queue+orders `cancelled`, completion screen | ✅ |
| 13 | Expiry (60s queue) | orders `expired` on read/heartbeat, `completed` | ✅ |
| 14 | Success on expired order | `not_payable`, audit-only | ✅ |
| 15 | Rate limit (11 rapid creates) | 429 after limit | ✅ |
| 16 | Live mode: no/wrong signature | 401 | ✅ |
| 17 | Live mode: valid HMAC signature | advance + `providerRef` stored | ✅ |
| 18 | Live mode: simulate endpoint | 403 | ✅ |
| 19 | UI golden path (browser) | DEMO badge, Live chip, swipe+PAID stamp, history, confetti completion | ✅ |
| 20 | Server-side payment while screen open | UI advances with zero interaction (SSE) | ✅ |
| 21 | Payment while tab backgrounded | advance applied on resume (resync) | ✅ |
| 22 | Mobile 390px | layout fits, scroll lock, 196px QR | ✅ |
| 23 | Reduced motion | fade transitions via `useReducedMotion`; CSS media blocks served | ✅ (CSS verified; motion emu not available in CLI) |
| 24 | Duplicate-queue prevention | cancelled queue + same key reopens same queue, no duplicates | ✅ |

## 8. Scaling notes / known limits

- Single-instance only: SSE bus + rate limiter are in-memory. For multi-node,
  swap `event-bus.ts` for Redis pub/sub and the limiter for Redis counters.
- SQLite fits the sandbox; Postgres is a drop-in via Prisma datasource change.
- `prisma:query` logging is on in dev (`src/lib/db.ts`); disable query logs in
  production. Audit payloads never store PSP secrets (redacted whitelist).
