# UPI Recipient Discovery — Setup & Operations Guide

Mobile-number-based recipient search ("find a UPI recipient" in the style of
PhonePe & other UPI apps) for QR19: enter an Indian mobile number → the
backend resolves it through the payment provider → the user confirms the
payee → pays inside their own UPI app. Alternatives: direct UPI ID entry and
on-device QR scanning.

> The live screen is in the **Find recipient** section (`#find-recipient`).

---

## 1. What is PRODUCTION vs DEMO vs UNVERIFIED (read this first)

| Capability | Status | Notes |
|---|---|---|
| Indian mobile normalization + validation (+91 / 0 / separators, 6–9 start) | **Production-quality** | `src/lib/upi-lookup/phone.ts`; pure, shared client+server |
| Authenticated access (session gate on every lookup) | **Verified in E2E** | Signed HMAC cookie; 401 without session; expiry handled |
| Anti-abuse rate limits (per-IP **and** per-session) | **Verified in E2E** | 8/min/IP, 5/min/session, sign-in 12/5min; 429 + `Retry-After` |
| UPI ID format validation (explicitly *format-only*) | **Verified in E2E** | The app never claims format-valid = account exists |
| Clear UI states: loading / invalid / no match / unsupported / rate-limit / unavailable | **Verified in E2E** | Each mapped from a distinct API response |
| On-device QR scanning + photo-upload fallback | **Production-quality** | jsQR in-browser; image never uploaded |
| UPI intent link generation (`upi://pay?...`) | **Production-quality** | Reuses `src/lib/upi.ts`; authorization stays in the UPI app |
| **Live mobile-number → UPI resolution ("UPI Number" / alias lookup)** | **NOT CONNECTED — demo only** | No PSP credentials or approved resolution API exist in this environment. A fail-closed placeholder returns `501 lookup_unsupported` |
| Demo lookup results | **Demo-only, labeled** | Fixed synthetic directory (5 numbers); unknown numbers are honestly "not found"; one number simulates a provider outage |
| Log hygiene | **Production-quality** | No numbers, names or VPAs in logs — only `mode`, `result`, latency. Nothing from a lookup is persisted |

**Honest summary:** the feature ships a complete, verified *lookup
orchestration layer* (auth gate → normalization → provider adapter →
confirmation UI → intent-link payment). The number→VPA resolution itself is
**synthetic (DEMO)** because no bank/PSP API is configured. It is never
presented as real.

---

## 2. Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `UPI_LOOKUP_MODE` | no | `demo` (default) or `live`. Anything but `live` → demo |
| `SESSION_SECRET` | **yes in production** | HMAC key for the session cookie. If unset/short, a public dev key is used and the session endpoint reports `insecureSecret: true` |

---

## 3. API reference

| Method | Path | Auth | Rate limit | Purpose |
|---|---|---|---|---|
| GET | `/api/upi-lookup` | — | — | Capability descriptor: mode, `mobileNumberLookup`, demo test numbers |
| POST | `/api/upi-lookup` | session | 8/min/IP + 5/min/session | `{ phone }` → `found` / `not_found` / `501 unsupported` / `503 unavailable` |
| POST | `/api/upi-lookup/validate-upi-id` | session | 20/min/IP | Format-only VPA check (never account existence) |
| GET/POST/DELETE | `/api/upi-lookup/session` | — | 12/5min (POST) | Demo session create / read / destroy |

`found` response shape:

```json
{
  "mode": "demo",
  "disclaimer": "DEMO data — synthetic result for testing, not a real UPI match.",
  "result": {
    "kind": "found",
    "payeeName": "Asha Sharma",
    "upiId": "asha.sharma901@upidemo",
    "recipientToken": "rt_demo_f36f44fbe3ed5bfd97",
    "queriedMobileMasked": "••••• 0001"
  }
}
```

In a **live** adapter, `upiId` may be absent — return `recipientToken` only
(the payment step then needs a server-side intent-creation endpoint that
resolves the token; see §5). Mask VPAs whenever full disclosure isn't
required (`maskUpiId()`).

---

## 4. Demo mode details

Synthetic directory (`src/lib/upi-lookup/provider.ts`):

| Number | Result |
|---|---|
| `99999 00001` … `99999 00005` | Found: Asha Sharma, Rahul Verma, Priya Iyer, Karthik Menon, Meera Nair (`@upidemo` VPAs — fake handle) |
| `99999 0009` | Simulated provider outage → `503` |
| anything else | Honestly `not_found` — **the demo never invents a match for an arbitrary number** |

The UI shows a persistent amber DEMO banner, "Demo data" chips on every
result, and the demo sign-in is explicitly labeled as a stand-in for real
provider/OAuth authentication.

---

## 5. What a real (production) integration requires

Do **not** assume a mobile number is searchable. Number→handle resolution is
the regulated **"UPI Number"** capability. Before writing any live adapter,
get written confirmation from your sponsoring bank / PSP of ALL of:

1. **Approved API** for mobile-number/UPI-Number alias resolution (exact
   endpoint, request/response contract, errors) — from your PSP's official
   documentation, behind your merchant account. Public documentation is often
   not sufficient; ask their integration team explicitly.
2. **Merchant credentials** kept server-side only: API key/secret or mTLS
   certificates, IP allow-listing, etc.
3. **Consent & data-use terms**: NPCI/ISP rules on number lookup
   (discoverability settings, purpose limitation, masking expectations).
4. **Rate quotas** from the provider, mirrored by the in-app limits.

Implementation path (when approved):
- Add `src/lib/upi-lookup/providers/<psp>.ts` implementing `UpiLookupProvider`
  (`src/lib/upi-lookup/provider.ts`), return `payeeName` + `recipientToken`
  (or `upiId` only if the contract permits disclosure).
- Prefer server-side payment creation: `POST /api/upi-pay/intents` resolves
  the recipient token → creates the PSP payment/intent → returns SDK params.
  Keep credentials exclusively in API routes.
- Replace the demo session gate with real auth (NextAuth, OAuth, or your
  PSP's merchant auth) in `src/lib/upi-lookup/session.ts`.
- Set `UPI_LOOKUP_MODE=live` + real `SESSION_SECRET`; fail-closed behavior is
  already wired (no adapter ⇒ `501`, never a fake result).

**What this app will never do:** guess VPAs from numbers, generate "likely"
IDs, scrape PhonePe/any app, call unofficial/private APIs, or treat a
returned name as verified identity.

---

## 6. Test checklist (executed & passing in this environment)

Sandbox convention: no test files — recorded E2E via curl + browser.

| # | Scenario | Expected | Result |
|---|---|---|---|
| 1 | Lookup without session | 401 `unauthorized` | ✅ |
| 2 | Demo sign-in + whoami | 201 + signed cookie, `insecureSecret:false` | ✅ |
| 3 | Invalid phone (`12345`, `+91 12345…`) | 400 with message | ✅ |
| 4 | Directory number | 200 `found` + DEMO disclaimer + masked mobile | ✅ |
| 5 | Unknown number | 200 `not_found` | ✅ |
| 6 | Outage number `99999 0009` | 503 `provider_unavailable` (retryable) | ✅ |
| 7 | Flood (6+ in-window per session) | 429 + `Retry-After: N` | ✅ |
| 8 | UPI ID format check (valid/invalid) | `valid:true` + normalized / `valid:false` | ✅ |
| 9 | Sign out → lookup | 401 | ✅ |
| 10 | `UPI_LOOKUP_MODE=live` without PSP | config `mobileNumberLookup:false`; lookup → 501 `lookup_unsupported` | ✅ (reverted to demo after) |
| 11 | Browser golden path | sign in → find → confirm → amount → app icons → intent link | ✅ |
| 12 | QR photo upload decode | parsed VPA + name → confirm → payment | ✅ |

## 7. Known limits

- Single-instance in-memory rate limiter (swap for Redis to scale out).
- Demo session auth is deliberately lightweight — real deployments replace it.
- The demo returns a full (fake) VPA so the intent-link step is testable; a
  live adapter should return a token/masked handle per the PSP contract.
