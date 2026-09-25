# Payments: Current State (Razorpay, one shared account)

> **Read this first for anything payment-related.** It is the current-state page. History and evidence live in `docs/launch/LAUNCH-CHECKLIST.md` (B1, B3, B5, B9, B12, B17, B18-B24). Procedures live in `docs/runbooks/PAYMENT-*.md`. Background advice is in `RAZORPAY-SHARED-ACCOUNT-GUIDANCE.md`.
> Last reconciled: **2026-09-25**.

## Setup

- One Razorpay account, one personal bank account, three sites: `ai-borne.in`, `ssbmax.ai` (`ssbmax.in` redirects; never use `.in` in copy), `actionstation.in`.
- Razorpay display name: `ai-borne`. KYC approved, bank account verified. Settlement due 2026-09-28.
- Test mode and live mode are separate on Razorpay: own keys, own webhook lists, own payments. Each app keeps its own copy of the keys in its own secret store, so the apps can be in different modes at the same time.

## Mode per app (2026-09-25)

| App | Mode | Notes |
|-----|------|-------|
| ActionStation | **LIVE** since 2026-09-24 | Secret Manager v4 for `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; v3 (test) enabled as rollback. Revisions `razorpaywebhook-00023-meq`, `createrazorpayorder-00023-wim` |
| SSBMax | **TEST keys** (owner, 2026-09-25) | Go-live is its own job (see below) |

## Webhooks

| Mode | Endpoint | Events | State |
|------|----------|--------|-------|
| Live | ActionStation `razorpayWebhook` | 7: `payment.captured`, `refund.processed`, 5x `subscription.*` | Enabled, registered 2026-09-24 20:44 IST |
| Test | SSBMax `handleRazorpayWebhook` | 12 | Only test webhook on the account (read 2026-09-25). No ActionStation test webhook exists |

- The five `subscription.*` events are unused (ActionStation sells one-time orders only). **Decision 2026-09-25: leave the 7-event webhook as is.** It is the setup proven in B24, and our code ignores those events and returns 200. Trimming is optional tidiness, not needed.
- Every handler must verify `X-Razorpay-Signature` first, and must return 200 for events it does not own (a 4xx makes Razorpay retry and can disable the webhook).

## Cross-app routing

- ActionStation stamps `notes.source = actionstation` on its orders and ignores anything else.
- SSBMax ignores events stamped `actionstation` (deployed, unit-tested). Legacy SSBMax payments have no source and count as SSBMax's own.
- Not yet proven live: SSBMax's filter, because SSBMax has no live traffic. Look for its log line "belongs to another app on the shared account -- acknowledged" after SSBMax goes live.
- Any new product on this account must stamp its own `notes.source` and ignore the others.

## Live proof (B24, 2026-09-24)

Temporary Rs 1 price on the free-tier test account: order `order_TfvmRqSOryflw3`, payment `pay_TfvnAey2b4vwH8` captured, webhook 200, user became Pro; refund `rfnd_TfvqxT46EeAhki`, `refund.processed` 200 (about 4 minutes late, Razorpay lag), user back to Free. Price reverted to Rs 2,999/yr (`PRO_ANNUAL_INR_PAISE = 299_900`).

## Legal pages (Razorpay reviews every submitted URL)

Privacy, Terms, Refund & Cancellation and Contact must load signed out and be linked in every footer. Verified 2026-09-24 on all three sites. Contact on all three: founder@ai-borne.in, +91 89369 95020, Pranidi (20B), Near D Mart, Pune 411045, Maharashtra. Price stays visible in INR before checkout.

## When SSBMax goes live (owner steps)

1. Add live key id and secret as new secret versions for SSBMax, redeploy its functions.
2. Register SSBMax's own **live** webhook with its own live secret. It will also receive ActionStation live events; the filter makes that safe.
3. Run a small real payment and refund, and confirm the filter log line above.
4. **Shared-key warning:** once SSBMax is live, the live key pair is shared. Regenerating it for one product retires it for both (this broke checkout on 18 Aug 2026, B13). Coordinate first. See `PAYMENT-INCIDENTS.md` Runbook 5.

## Risks to watch

- Order notes carry `userId` and `planId` in the same shape across apps; `notes.source` is the only separator.
- A browser holding an old service worker needs one reload after a deploy (HTML is no-cache).
- Payments carry customer email/phone from the other product in cross-delivered payloads.

## Open

- B9 GST / invoicing decision.
- B17 stuck test refund `pay_TeCo0SIEDxJ29q` (test money only).
- D2 human review of Terms and Privacy (entity name, address, DPDP).
- D5 PCI SAQ-A sign-off (`docs/compliance/PCI-SAQ-A.md`).
- SSBMax live go-live and live proof of its filter.
- Optional: disable secret v3 (test keys) once rollback is no longer wanted.
