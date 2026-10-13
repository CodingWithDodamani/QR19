# QR19 — Collect the full amount

QR19 splits any bill into UPI QR codes of **₹1,999 or less** and collects the
full amount, one verified payment at a time. Built for Indian merchants —
works with PhonePe, Paytm, Razorpay or the clearly-labeled demo processor.

## Highlights

- **Sequential verified collection** — one QR on screen at a time; the next
  appears only after the payment provider confirms the previous payment
  (webhook + polling, idempotent, server-authoritative).
- **Fraud Shield** — a provider transaction reference can verify exactly one
  QR. Replayed screenshots, underpayments, stale/foreign payments and forged
  webhooks are blocked server-side and surfaced to the merchant in real time.
- **Unique amount per QR (anti-scam toggle)** — every QR on a bill gets a
  different amount (≥ ₹1 apart, sum = exact bill), so the amount that lands
  identifies exactly which code was paid.
- **Multi-PSP console** — connect your own PhonePe PG v1, Paytm Dynamic QR v3
  or Razorpay QR Codes API credentials (encrypted at rest, AES-256-GCM).
  Without credentials the app runs in clearly-labeled demo mode.
- **UPI recipient discovery** (demo) — find a payee by mobile number, UPI ID
  or by scanning their QR.
- Zero fees, no accounts, mobile-first, printable QR sheets.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 ·
shadcn/ui · Prisma (SQLite) · Server-Sent Events · framer-motion

## Quick start

Requires **Node.js 20+** (or [Bun](https://bun.sh)) and no external services.

```bash
# 1. Install dependencies
npm install            # or: bun install

# 2. Create your env file
cp .env.example .env   # defaults are fine for local development

# 3. Create the SQLite database (also generates the Prisma client)
npx prisma db push     # or: bun run db:push

# 4. Run the dev server
npm run dev            # or: bun run dev  → http://localhost:3000
```

Open `http://localhost:3000`, scroll to the tool, enter your UPI ID and an
amount, and generate QR codes. "Start collecting" opens the server-verified
collection screen.

> The first run creates `db/custom.db` automatically. TypeScript, ESLint and
> the dev server are configured and clean — no extra setup needed.

## Connecting a real PSP (optional)

Open **PSP console** in the site navigation. Enter your own credentials from
the provider's business dashboard:

- **PhonePe** PG v1 — merchant ID + salt key + salt index (UAT or production)
- **Paytm** Dynamic QR v3 — MID + merchant key (staging or production)
- **Razorpay** — key id + key secret (+ webhook secret)

Each provider is validated with a real connection test the moment you save.
Live webhooks need a public URL — until then, the built-in polling fallback
still advances queues automatically. See `docs/psp-console.md` and
`docs/fraud-shield.md` for the full setup and security model.

## Project structure

```
src/app/                 Next.js App Router (pages + API routes)
src/components/qr19/     The payment tool + verified collection screen
src/components/landing/  Landing page sections (hero, features, PSP console…)
src/lib/upi.ts           Amount parsing, standard + unique-amount splitters
src/lib/payment/         Queue service, PSP clients, fraud detection
prisma/schema.prisma     Queues, orders, webhook ledger, fraud alerts, PSP settings
db/                      SQLite database (created on first push)
docs/                    Setup + architecture docs
scripts/                 export-source.sh — rebuilds the downloadable source zip
```

## Regenerating the source-code zip

The "Download source code" button in the footer serves
`public/qr19-source-code.zip`. Rebuild it any time with:

```bash
bash scripts/export-source.sh
```

## Notes

- Demo mode never fakes a real payment; every simulated event is labeled and
  runs through the same server pipeline as a real webhook.
- PSP secrets are stored encrypted and are never returned to any client.
- UPI is a product of NPCI. QR19 is not affiliated with NPCI or any payment app.
