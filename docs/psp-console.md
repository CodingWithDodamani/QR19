# Real PSP console (Razorpay)

The app's PSP console turned the old demo-only panel into a **real payment
provider console**. With Razorpay credentials configured, sequential
collections stop being simulated and start using the provider's actual
money-moving, payment-verifying APIs.

Everything here follows Razorpay's official documentation (QR Codes API,
webhooks, authentication). No endpoints are invented, and nothing synthetic
is ever presented as a real payment.

---

## 1. Why a PSP at all (honest boundary)

A raw `upi://` QR can *show* a payment request, but nothing on the open UPI
network can tell your server that money actually arrived. Only a licensed
Payment Service Provider (PSP) can (a) accept the payment into a merchant
account and (b) confirm it to your backend via signed webhooks / verified
APIs. That is what this console unlocks.

## 2. What works today vs. what needs you

| Capability | Status | Notes |
| --- | --- | --- |
| Console UI (setup, status, test, monitor, disconnect) | ✅ working | Landing page → "PSP console" section |
| Credential storage: AES-256-GCM encrypted, server-only, masked preview | ✅ working | Key secret is never returned to any client |
| Connection test against real `api.razorpay.com` | ✅ working | Verified: invalid keys get Razorpay's real 401 ("Authentication failed") |
| Real per-order QR creation (`POST /v1/payments/qr_codes`, `upi_qr`, single_use, fixed_amount, notes echo) | ✅ implemented | **Unverified with real keys** (needs your Razorpay account + QR Codes product enabled) |
| Real Razorpay QR display via server-side image proxy | ✅ implemented | Only QR ids this app provisioned are proxied |
| Signed webhook verification (`X-Razorpay-Signature`, HMAC-SHA256 over raw body, `x-razorpay-event-id` dedupe) | ✅ verified | Tested end-to-end with valid/invalid/replayed signatures |
| `qr_code.credited` / `payment.captured` / `payment.failed` mapping | ✅ implemented | Order matched by QR id or echoed `notes.orderId`; only `captured` advances |
| Webhook-less verification fallback (poll `GET /v1/payments/qr_codes/:id/payments`) | ✅ implemented | Runs on the SSE heartbeat + on connect; deterministic event ids keep it idempotent with webhooks |
| Test-mode signed webhook test (exercises the REAL webhook path) | ✅ implemented | Razorpay-test mode only; payload mimics documented `qr_code.credited`, payment id prefixed `pay_synthtest_` |
| Live-mode simulation lockout | ✅ verified | `/simulate` → 403, webhook-test → 403 in `razorpay-live` |
| Scannable live QRs + real money movement | ⛔ needs you | Requires Razorpay KYC activation, live keys (`rzp_live_…`), and the **QR Codes product enabled (on-demand)** for your account |
| Webhooks reaching this deployment | ⛔ needs you | Razorpay requires a public HTTPS URL (localhost/tunnels blacklisted). Until then the polling fallback advances queues |
| UPI pricing | ℹ️ note | Zero MDR on UPI, but Razorpay applies a ~2% + GST platform fee on its standard plan |

## 3. Setup guide

1. **Create a Razorpay account** — dashboard.razorpay.com. Email/mobile +
   OTP; **test mode keys are instant and need no KYC**.
2. **Enable the QR Codes product** — it is on-demand: raise a request from
   your dashboard (or via your Razorpay point of contact). Without it, QR
   creation fails with a descriptive error (surfaced honestly in the UI).
3. **Paste your keys in the console** — Key ID (`rzp_test_…`/`rzp_live_…`)
   + Key Secret (+ webhook secret when you have one). Saving runs a real
   connection test immediately. The secret is stored AES-256-GCM encrypted
   and never displayed again.
4. **Configure the webhook** — Dashboard → Account & Settings → Webhooks →
   Add New Webhook:
   - URL: the **Webhook URL** shown in the console (`…/api/webhooks/razorpay`)
   - Secret: any strong value → paste the same value into the console
   - Active events: `qr_code.credited`, `payment.captured`, `payment.failed`
   - The URL must be public (deploy/tunnel on your own domain).
5. **Go live** — complete KYC, switch to `rzp_live_…` keys. Live keys put
   the app in `razorpay-live` mode: real QRs, real money, no simulation.

### If webhooks can't reach your deployment

Queues still advance: every SSE heartbeat polls the provider for captured
payments on the current QR (Razorpay's own payments API as the source of
truth). Set `APP_ORIGIN` if the console's self-delivery test needs a
specific origin.

## 4. Modes

| Mode | Trigger | Behavior |
| --- | --- | --- |
| `demo` | No credentials (default) | Raw UPI QRs rendered client-side; advances only via the labeled demo simulator; `/api/webhooks/razorpay` is inert (403) |
| `razorpay-test` | `rzp_test_` keys saved | Real API calls; real QR ids/images; **test QRs cannot be scanned by UPI apps** (Razorpay FAQ); signed webhook test available |
| `razorpay-live` | `rzp_live_` keys saved | Real money. Simulation endpoints hard-disabled (403). Advances only on Razorpay confirmation (webhook or poll) |
| `live` | Legacy env: `PAYMENT_MODE=live` + `PAYMENT_WEBHOOK_SECRET` | Generic signed webhook contract (`/api/webhooks/payment`) — unchanged |

Mode resolution is cached for 5 s and fail-closed: an undecryptable key
secret falls back to demo rather than half-configured operation.

## 5. How the real flow works

```
QR tool → POST /api/payment-queues
  └─ queue created; current order marked displayed
      └─ ensureProviderQr(order): Razorpay QR created on demand
         (single_use, fixed_amount = exact order amount,
          notes = {queueId, orderId, app}, close_by ≤ 2 h)
          ├─ success → providerQrId + image stored, state pushed
          └─ failure → providerQrError stored (honest error card, 45 s backoff)

Customer scans the RAZORPAY QR (real VPA of your Razorpay account)
  ├─ webhook: POST /api/webhooks/razorpay
  │    HMAC-SHA256(raw body, webhook secret) verified timing-safe
  │    dedupe on x-razorpay-event-id
  │    qr_code.credited → payment.success for that order
  └─ fallback: SSE heartbeat polls GET /v1/payments/qr_codes/:id/payments

processProviderEvent (single verified write path)
  amount must match exactly → order paid → next QR swipes in
  wrong amount / repeat / out-of-order → recorded + audited, never advances
```

In Razorpay modes the original raw UPI deep link (`qrPayload`) is
deliberately **not displayed** — paying it would bypass the PSP and could
never be verified.

## 5b. WhatsApp payment alerts (opt-in)

The instant a queue order transitions to `paid` (server-verified provider
event only — demo simulator uses the same path), the app fire-and-forgets a
Meta WhatsApp Cloud API template message to every configured recipient. The
send is deliberately detached from the money path: a failure is logged and
never affects the queue.

- **Switch:** `WHATSAPP_ALERTS=off` (default, unset = off) | `demo`
  (logs what WOULD send, never touches the network) | `live` (real sends via
  `https://graph.facebook.com/v21.0`, fails CLOSED when creds/recipients are
  missing). See `.env.example` for the full block.
- **Template:** `payment_received` (or `WHATSAPP_TEMPLATE_NAME`) with exactly
  5 positional body params in order — `{{1}}` amount (₹), `{{2}}` seq,
  `{{3}}` totalOrders, `{{4}}` provider, `{{5}}` providerRef (or "—"). Create
  and approve it in Meta Business Suite before going live.
- **Recipients = env ∪ console:** `WHATSAPP_RECIPIENT` (comma-separated E.164
  without "+", e.g. `919876543210,919123456789`) plus numbers typed into the
  PSP console card "WhatsApp payment alerts → Alert numbers added here"
  (stored in `WhatsappRecipient`, max 20, normalized to 8-15 digits, deduped
  env-first). Both lists receive the same template, including the test alert.
- **Console:** sign in as merchant (ADMIN_TOKEN), add/remove numbers
  (full numbers are never returned — only masked like `91•••••3210`), then
  "Send test alert" to verify end-to-end. Demo mode logs; off/misconfigured
  returns 409 with a clear reason.

## 6. API reference (new)

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/psp/status` | GET | public (no secrets) | Mode, masked key, webhook URL, last test result |
| `/api/psp/configure` | POST/DELETE | ADMIN_TOKEN bearer (demo session accepted in dev only) | Save/rotate (encrypted + instant test) / wipe credentials |
| `/api/psp/events` | GET | ADMIN_TOKEN bearer (demo session accepted in dev only) | Monitor ledger: webhook/poll/demo/synthetic events + provisioning audit |
| `/api/psp/fraud-alerts` | GET | ADMIN_TOKEN bearer (demo session accepted in dev only) | Fraud Shield feed + severity summary |

Operator auth (P0-2): every operator endpoint requires
`Authorization: Bearer <ADMIN_TOKEN>` (timing-safe compare). In local dev
the demo signed-session cookie is still accepted for convenience; in
production with `ADMIN_TOKEN` set, the session alone returns 401. The
console UI has an operator sign-in box — the token is kept tab-scoped in
`sessionStorage` and never in a cookie. `psp/status` stays public (masked
key id only). Staff skip/cancel overrides require the same token.
| `/api/psp/qr-image/:qrId` | GET | public, rate-limited | Proxy for a provisioned Razorpay QR image (never an open proxy) |
| `/api/psp/whatsapp-test` | GET / POST | ADMIN_TOKEN bearer (demo session accepted in dev only) | Masked alert status (GET) / send `payment_received` test to all recipients (POST; demo logs, off/misconfigured → 409) |
| `/api/psp/whatsapp-recipients` | GET / POST | ADMIN_TOKEN bearer (demo session accepted in dev only) | List console-added numbers masked (GET) / add one number `{ "number" }` 8-15 digits, max 20, deduped vs env + DB (POST → 201/400/409) |
| `/api/psp/whatsapp-recipients/:id` | DELETE | ADMIN_TOKEN bearer (demo session accepted in dev only) | Remove one console-added number (env numbers can't be removed here) |
| `/api/webhooks/razorpay` | POST | HMAC signature | Real Razorpay webhook receiver |
| `/api/payment-queues/:id/webhook-test` | POST | — (rate-limited) | Signed synthetic delivery through the REAL webhook path (test mode only) |

Environment: `PSP_ENCRYPTION_KEY` (set before storing **live** keys),
`APP_ORIGIN` (optional, for webhook self-delivery), existing
`SESSION_SECRET` (console session gate), plus `ADMIN_TOKEN` (operator gate
for all PSP mutations + monitors + staff overrides). All four must be ≥32
chars in production — `src/instrumentation.ts` refuses to boot otherwise
(fail closed); development warns and uses clearly-labeled demo fallbacks
(demo session accepted without the token locally).

## 7. Security notes

- Key secret + webhook secret: AES-256-GCM (scrypt-derived key), DB-stored,
  never returned by any endpoint (masked preview only), wipeable instantly.
- Console mutations + monitors + staff skip/cancel are ADMIN_TOKEN-gated
  (P0-2: `Authorization: Bearer`, timing-safe; demo session accepted in dev
  only — production with ADMIN_TOKEN set returns 401 on session alone).
  Put the deployment behind HTTPS and rotate the token with
  `openssl rand -hex 32` if ever exposed.
- Webhooks fail closed: no secret configured → 403; bad signature → 401;
  unsigned processing is impossible.
- The webhook-test endpoint is **hard-disabled in live mode**; its
  synthetic payments are labeled `pay_synthtest_…` everywhere and are
  rendered as SIMULATED in the monitor.
- Rate limits: configure 8/min, test 6/min, events 60/min, image 120/min,
  webhook-test 6/min, webhooks 300/min.
- Provisioning calls collapse via an in-flight lock + 45 s error backoff
  (no API spam on repeated state reads).

## 8. Verified test results (this sandbox)

- Fake test keys → save succeeds, connection test honestly reports
  Razorpay's real "Authentication failed", queue shows the real error card.
- Webhook: wrong signature → 401; valid signature → order paid + advanced;
  exact replay → `duplicate`; wrong amount → `amount_mismatch`, no advance.
- Disconnect → immediate demo fallback; demo simulator works again.
- Razorpay-test screen: RAZORPAY TEST badge, honest provisioning error,
  test-mode copy, signed-test console. Mobile 390 px clean; zero console
  errors; lint clean.
