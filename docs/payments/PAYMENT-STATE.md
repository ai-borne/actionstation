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
| SSBMax | **TEST keys; Razorpay is being RETIRED** (owner decision 2026-09-25) | Payments move to store billing via RevenueCat. RevenueCat does not support Razorpay, so SSBMax never goes live on Razorpay. See the retirement plan below |

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
- The SSBMax filter will never be proven live: SSBMax is retiring Razorpay (see plan below), so it will not receive live traffic.
- Any new product on this account must stamp its own `notes.source` and ignore the others.

## Live proof (B24, 2026-09-24)

Temporary Rs 1 price on the free-tier test account: order `order_TfvmRqSOryflw3`, payment `pay_TfvnAey2b4vwH8` captured, webhook 200, user became Pro; refund `rfnd_TfvqxT46EeAhki`, `refund.processed` 200 (about 4 minutes late, Razorpay lag), user back to Free. Price reverted to Rs 2,999/yr (`PRO_ANNUAL_INR_PAISE = 299_900`).

## Legal pages (Razorpay reviews every submitted URL)

Privacy, Terms, Refund & Cancellation and Contact must load signed out and be linked in every footer. Verified 2026-09-24 on all three sites. Contact on all three: founder@ai-borne.in, +91 89369 95020, Pranidi (20B), Near D Mart, Pune 411045, Maharashtra. Price stays visible in INR before checkout.

## SSBMax facts (read from the SSBMax repo `origin/main`, 2026-09-25; re-verify before acting)

- Firebase project `ssbmax-49e68`. Webhook `handleRazorpayWebhook` (`webhooks.js`), secret `RAZORPAY_WEBHOOK_SECRET`. Order and subscription functions read `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from Firebase secrets.
- SSBMax sells **subscriptions** (Razorpay Subscriptions, monthly per tier) plus a legacy one-time `payment.captured` path. Mobile purchases go through RevenueCat, which is separate from Razorpay.
- Plan IDs come from the JSON secret `RAZORPAY_PLAN_IDS`. **Razorpay plan IDs are per mode**, so test plan IDs do not exist in live mode. (Historical detail; no longer a go-live item since Razorpay is being retired.)
- SSBMax does **not** stamp `notes.source` on its own orders or subscriptions; it sends `notes = { userId, planId }`. It only *ignores* events stamped `actionstation` (`razorpayForeignEvent.js`). No source means "SSBMax's own". ActionStation ignores anything not stamped `actionstation`, so the unstamped SSBMax events are already safe on our side.
- Its webhook has a 12-event set (subscription lifecycle, `payment.captured`, `refund.processed`). Mirror the test webhook's list for live.

## SSBMax Razorpay retirement plan (decision 2026-09-25)

**Decision:** SSBMax is a KMP app (iOS, Android). Purchases go through App Store / Play Store via RevenueCat, which is the single authority for entitlements. The SSBMax website only reads the entitlement and grants access. RevenueCat does not support Razorpay, so the SSBMax Razorpay integration (web orders, subscriptions, webhook path) is retired and the previous go-live checklist (S1-S18) is cancelled. Reason: one entitlement authority, no dual-provider conflicts, and the shared Razorpay account becomes ActionStation-only.

Work happens in the **SSBMax repo**. Tick items here with evidence. Owner tags as in the checklist: `(You)`, `(Claude)`.

**A. Confirm nothing live depends on Razorpay**
- [ ] R1 Razorpay **Live** view shows no SSBMax payments, subscriptions or mandates (SSBMax was on test keys; its architecture doc calls the `payment.captured` path "live in production", so check, do not assume) `(You)`.
- [ ] R2 SSBMax Firestore has no user whose subscription doc has `source = RAZORPAY` and a paid tier that must be preserved. If any exist, migrate them first (manual grant via RevenueCat promotional entitlement, or honour until expiry) `(You + Claude)`.

**B. Retire in the SSBMax repo (one PR, TDD, its own CLAUDE.md rules)**
- [ ] R3 Remove web checkout UI and the Razorpay callables (`payments.js`, `razorpaySubscriptions.js`, `razorpaySubscriptionCancel.js`), the Razorpay client, drift sweep, and Razorpay parts of `webhooks.js` and reconciliation `(Claude)`.
- [ ] R4 Make RevenueCat the only writer of the tier document; web reads it and shows "manage in your app store". Remove `assertNoActiveRevenueCatSubscription` and the `RAZORPAY` source branches once nothing writes them `(Claude)`.
- [ ] R5 Update its `Subscription_Payments_Architecture.md` and pricing docs to the store-only model `(Claude)`.
- [ ] R6 Legal/copy on `ssbmax.ai`: Refund & Cancellation and pricing text must match store billing (refunds are handled by Apple/Google). Razorpay's site review no longer applies to `ssbmax.ai`, but Apple/Google policies do `(You + Claude)`.
- [ ] R7 Deploy, then confirm no Razorpay function is still exported and RevenueCat webhook still returns 200 on a sandbox purchase `(You)`.

**C. Clean up the shared Razorpay account**
- [ ] R8 Delete SSBMax's **test** webhook in Razorpay (Test Mode, only remaining webhook) once R7 is deployed `(You)`.
- [ ] R9 Delete SSBMax's Razorpay secrets (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_IDS`, `RAZORPAY_WEBHOOK_SECRET`) from its Firebase project `(You)`.
- [ ] R10 Optionally remove `ssbmax.ai` from the Razorpay website list (Account & Settings) so the account reflects ActionStation and ai-borne only `(You)`.
- [ ] R11 Keep ActionStation's `notes.source` guard for now (harmless). Once R7-R9 are done, this file, checklist B12, and `PAYMENT-INCIDENTS.md` Runbook 5 drop the shared-account language `(Claude)`.

**Not affected:** ActionStation's live keys, webhook and drill (B24). Retiring SSBMax's Razorpay never requires touching them. Do not regenerate the live key as part of this.

**Follow-up (optional, later):** if web-only demand appears, add web purchases through RevenueCat Web Billing (verify India availability) so RevenueCat stays the hub.

## Risks to watch

- Order notes carry `userId` and `planId` in the same shape across apps; `notes.source` is the only separator.
- A browser holding an old service worker needs one reload after a deploy (HTML is no-cache).
- Payments carry customer email/phone from the other product in cross-delivered payloads.

## Open

- B9 GST / invoicing decision.
- B17 stuck test refund `pay_TeCo0SIEDxJ29q` (test money only).
- D2 human review of Terms and Privacy (entity name, address, DPDP).
- D5 PCI SAQ-A sign-off (`docs/compliance/PCI-SAQ-A.md`).
- SSBMax Razorpay retirement (R1-R11 above), decided 2026-09-25.
- Optional: disable secret v3 (test keys) once rollback is no longer wanted.
