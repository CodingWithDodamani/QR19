# Fraud Shield — stopping payment-proof scams

The scam this solves (extremely common at Indian counters):

> A customer pays ONCE (₹1,999), then shows the same screenshot / SMS /
> "success" screen again for the next item — and the next — collecting goods
> five times for one payment. Merchants who trust "customer-shown proof" lose
> money every day to this.

## The core rule

**The app never accepts customer-shown proof as an input. Not screenshots, not
SMS, not a forwarded "success" screen.** The ONLY thing that can complete a QR
is a confirmed event from the payment provider itself (signed webhook or the
provider's own status API). One provider transaction reference (UTR / RRN /
payment id) can verify **exactly one order, ever**.

## What is enforced, where

| Threat | Enforcement point | Fraud Shield alert |
| --- | --- | --- |
| Reused payment proof (1 payment shown 5×) | `processProviderEvent` duplicate-reference guard: `PaymentOrder.providerRef` is unique across paid orders; a second order presenting the same ref is rejected (`duplicate_txn_ref`) | `DUPLICATE_TXN_REF` (high) |
| Underpayment / amount edit in the UPI app | amount-equality check before marking paid (`amount_mismatch`) | `AMOUNT_MISMATCH` (high) |
| Second "success" for an already-paid order | already-paid path, silent only for the identical re-delivery | `REPLAYED_SUCCESS` (medium) |
| Money for expired/skipped/cancelled QRs | recorded, never counts as progress | `STALE_ORDER_PAYMENT` (medium) |
| Success for an order reference that doesn't exist | recorded (`unknown_order`) | `UNKNOWN_ORDER_PAYMENT` (medium) |
| Forged webhook deliveries | timing-safe HMAC / X-VERIFY / checksumhash verification, fail-closed | `SIGNATURE_FAIL` (low, one row per provider) |

Supporting invariants (pre-existing, unchanged):

- Every order has a unique `orderId` (UPI `tr`) and — in PSP modes — its own
  provider artifact (Razorpay single-use QR / Paytm dynamic QR bound to
  MID+orderId / PhonePe merchantTransactionId).
- Event processing is idempotent (`WebhookEvent` ledger); retries and
  webhook-vs-poll double delivery collapse safely.
- Only `paid` (provider-verified) orders advance the sequential queue;
  skipped/cancelled are never labeled paid.

## Merchant-facing surfaces

1. **Fraud Shield panel** on the collection screen
   (`verified-payment-mode.tsx`): guarantees list, live alert feed
   (severity-tinted, deduped with ×count), and the **"Verify payment now"**
   button — the counter-move to "payment ho gaya": the server asks the
   provider directly and answers definitively. Data: `GET
   /api/payment-queues/:id/security` (public, rate-limited), action: `POST
   /api/payment-queues/:id/verify-now`.
2. **Payment history** rows show the provider reference (`ref …`) for paid
   orders so the merchant can cross-check against the PSP/bank dashboard.
3. **PSP console → Fraud alerts** card (`psp-console.tsx`): operator-only
   feed via `GET /api/psp/fraud-alerts` (session-gated) with severity chips
   and aggregate counts.
4. **Demo console** keeps one primary **"Simulate scan & payment"** button; the attack simulators (including a **"Reused payment proof"** button that replays the
   previous payment's reference against the current QR — the exact scam) live under a **"Fraud & edge training"** disclosure, so the merchant can watch the shield block it before trusting it with real
   money. (`POST …/simulate`, outcomes `declined` / `wrong_amount` / `duplicate_success` / `replayed_proof`, demo mode only.)

## Data model

`FraudAlert` (Prisma): deduped by a stable `fingerprint`
(type + queue/order + discriminator) so repeated attacks increment
`count`/`lastSeenAt` instead of flooding the ledger; `SIGNATURE_FAIL` uses a
per-provider bounded row. `PaymentOrder.providerRef` is indexed for the
uniqueness lookup. Recording is best-effort and never blocks the payment path.

## Merchant SOP (also taught in the UI)

1. Never hand over goods for a screenshot — only for the green **PAID / VERIFIED**
   stamp on the collection screen.
2. If the customer insists, tap **Verify payment now** — the provider's answer
   is definitive.
3. Cross-check the `ref` shown in payment history against your PSP dashboard.
4. Any red alert row = blocked attempt; the queue did not move.

## Honest boundaries

- Demo mode is clearly labeled; its events are simulated and every demo-caused
  alert is a real row in the same ledger (good for training staff).
- Alerts tell the merchant what happened; they cannot reverse real money. For
  `STALE_ORDER_PAYMENT` / `UNKNOWN_ORDER_PAYMENT` the merchant reconciles or
  refunds in the PSP dashboard.
- UPI has no card-style chargebacks; social engineering outside the app (e.g.
  customer walks away without paying at all) is out of any software's reach —
  the shield's job is to make sure a *fake or reused proof can never look
  like a completed payment*.

## Verified test results (curl + agent-browser)

- Underpay ₹2,000-claim on a ₹1,999 QR → blocked (`amount_mismatch`), alert recorded.
- Pay QR #1, replay its proof on QR #2 → blocked (`duplicate_txn_ref`), order #2
  stayed `displayed`, alert recorded; repeating increments ×count without new rows.
- Replay before any payment → honest 409 "No earlier verified payment to replay".
- Bad-signature webhook → 401 + `SIGNATURE_FAIL` row (per provider).
- `/api/psp/fraud-alerts` → 401 without session; feed + severity summary with session.
- Browser: shield panel, badge counts, alert feed, verify-now honest demo answer,
  PSP console fraud card — desktop 1280px + mobile 390px, no overflow, no console
  errors on clean load; lint clean.
