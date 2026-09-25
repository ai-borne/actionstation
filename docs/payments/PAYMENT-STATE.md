# Payments: Current State (Razorpay, ActionStation only)

> **Read this first for anything payment-related.** It is the current-state page. History and evidence live in `docs/launch/LAUNCH-CHECKLIST.md` (B1, B3, B5, B9, B12, B17, B18-B24). Procedures live in `docs/runbooks/PAYMENT-*.md`. Background advice is in `RAZORPAY-SHARED-ACCOUNT-GUIDANCE.md`.
> Last reconciled: **2026-09-25** (SSBMax's Razorpay integration is fully retired; the account is now ActionStation-only).

## Setup

- One Razorpay account, one personal bank account. Sites that use it: `actionstation.in` (approved on the Razorpay website list, read 2026-09-25) and `ai-borne.in`. `ssbmax.ai` no longer uses Razorpay (store billing via RevenueCat) and is not on the list.
- Razorpay display name: `ai-borne`. KYC approved, bank account verified. Settlement due 2026-09-28.
- Test mode and live mode are separate on Razorpay: own keys, own webhook lists, own payments. ActionStation keeps its own copy of the keys in its own secret store.

## Mode per app (2026-09-25)

| App | Mode | Notes |
|-----|------|-------|
| ActionStation | **LIVE** since 2026-09-24 | Secret Manager v4 for `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; v3 (test) enabled as rollback. Revisions `razorpaywebhook-00023-meq`, `createrazorpayorder-00023-wim` |
| SSBMax | **Not on Razorpay (retired 2026-09-25)** | Purchases are store billing via RevenueCat, which is the only entitlement writer; the SSBMax web only reads it. Its Razorpay functions, secrets and test webhook are deleted. See the retirement record below |

## Webhooks

| Mode | Endpoint | Events | State |
|------|----------|--------|-------|
| Live | ActionStation `razorpayWebhook` | 7: `payment.captured`, `refund.processed`, 5x `subscription.*` | Enabled, registered 2026-09-24 20:44 IST |
| Test | none | 0 | SSBMax's test webhook was deleted 2026-09-25 (R8); the Test Mode list is now empty. No ActionStation test webhook exists |

- The five `subscription.*` events are unused (ActionStation sells one-time orders only). **Decision 2026-09-25: leave the 7-event webhook as is.** It is the setup proven in B24, and our code ignores those events and returns 200. Trimming is optional tidiness, not needed.
- Every handler must verify `X-Razorpay-Signature` first, and must return 200 for events it does not own (a 4xx makes Razorpay retry and can disable the webhook).

## Order attribution

- ActionStation stamps `notes.source = actionstation` on its orders and ignores anything else. **Keep this guard** (harmless, and it protects any future product added to the account).
- Any new product on this account must stamp its own `notes.source` and ignore the others.
- History: while SSBMax shared the account, its webhook and ours received each other's events (cross-delivery). That ended with SSBMax's retirement (R7-R9).

## Live proof (B24, 2026-09-24)

Temporary Rs 1 price on the free-tier test account: order `order_TfvmRqSOryflw3`, payment `pay_TfvnAey2b4vwH8` captured, webhook 200, user became Pro; refund `rfnd_TfvqxT46EeAhki`, `refund.processed` 200 (about 4 minutes late, Razorpay lag), user back to Free. Price reverted to Rs 2,999/yr (`PRO_ANNUAL_INR_PAISE = 299_900`).

## Legal pages (Razorpay reviews every submitted URL)

Privacy, Terms, Refund & Cancellation and Contact must load signed out and be linked in every footer. Verified 2026-09-24 on the ActionStation, ai-borne and SSBMax sites (SSBMax's pages were later rewritten for store billing). Contact on all three: founder@ai-borne.in, +91 89369 95020, Pranidi (20B), Near D Mart, Pune 411045, Maharashtra. Price stays visible in INR before checkout.

## SSBMax facts

Obsolete. SSBMax no longer has any Razorpay integration; see the retirement record below and the architecture doc `Subscription_Payments_Architecture.md` in the SSBMax repo (ai-borne/SSBMax, under its docs/architecture folder).

## SSBMax Razorpay retirement (decision 2026-09-25) — COMPLETE

**Decision:** SSBMax is a KMP app (iOS, Android). Purchases go through App Store / Play Store via RevenueCat, which is the single authority for entitlements. The SSBMax website only reads the entitlement and grants access. RevenueCat does not support Razorpay, so the SSBMax Razorpay integration (web orders, subscriptions, webhook path) is retired and the previous go-live checklist (S1-S18) is cancelled. Reason: one entitlement authority, no dual-provider conflicts, and the shared Razorpay account becomes ActionStation-only.

Work happened in the **SSBMax repo** (PRs ai-borne/SSBMax#75 to #78). Items are ticked here with evidence. Owner tags as in the checklist: `(You)`, `(Claude)`.

**A. Confirm nothing live depends on Razorpay**
- [x] R1 Razorpay **Live** view shows no SSBMax payments, subscriptions or mandates (SSBMax was on test keys; its architecture doc calls the `payment.captured` path "live in production", so check, do not assume) `(You)`. *Done: owner confirmed no live SSBMax payers, 2026-09-25.*
- [x] R2 SSBMax Firestore has no user whose subscription doc has `source = RAZORPAY` and a paid tier that must be preserved. If any exist, migrate them first (manual grant via RevenueCat promotional entitlement, or honour until expiry) `(You + Claude)`. *Done 2026-09-25: a read-only Firestore scan found 4 docs with `source = RAZORPAY` (3 paid, all owner test accounts; 1 FREE); reset to FREE with `functions/scripts/reset-legacy-razorpay-subscriptions.js --apply`, re-scan finds 0.*

**B. Retire in the SSBMax repo (one PR, TDD, its own CLAUDE.md rules)**
- [x] R3 Remove web checkout UI and the Razorpay callables (`payments.js`, `razorpaySubscriptions.js`, `razorpaySubscriptionCancel.js`), the Razorpay client, drift sweep, and Razorpay parts of `webhooks.js` and reconciliation `(Claude)`. *Done: SSBMax PR #75.*
- [x] R4 Make RevenueCat the only writer of the tier document; web reads it and shows "manage in your app store". Remove `assertNoActiveRevenueCatSubscription` and the `RAZORPAY` source branches once nothing writes them `(Claude)`. *Done: SSBMax PR #75 (RevenueCat webhook always overwrites, web is read-only).*
- [x] R5 Update its `Subscription_Payments_Architecture.md` and pricing docs to the store-only model `(Claude)`. *Done: SSBMax PR #75.*
- [x] R6 Legal/copy on `ssbmax.ai`: Refund & Cancellation and pricing text must match store billing (refunds are handled by Apple/Google). Razorpay's site review no longer applies to `ssbmax.ai`, but Apple/Google policies do `(You + Claude)`. *Done: SSBMax PR #75 (Terms, Refund & Cancellation, FAQ now describe Apple/Google billing and refunds).*
- [x] R7 Deploy, then confirm no Razorpay function is still exported and RevenueCat webhook still returns 200 on a sandbox purchase `(You)`. *Done 2026-09-25: `firebase functions:list` shows no Razorpay function; the RevenueCat webhook (now bound to `REVENUECAT_WEBHOOK_SECRET`, SSBMax PR #76) returned 200 on RevenueCat's test event, and a Test Store purchase produced INITIAL_PURCHASE, RENEWAL and EXPIRATION with the tier following (BASIC to FREE).*

**C. Clean up the Razorpay account**
- [x] R8 Delete SSBMax's **test** webhook in Razorpay (Test Mode, only remaining webhook) once R7 is deployed `(You)`. *Done 2026-09-25: the Test Mode webhook list now reads "You have not setup any webhook".*
- [x] R9 Delete SSBMax's Razorpay secrets (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_IDS`, `RAZORPAY_WEBHOOK_SECRET`) from its Firebase project `(You)`. *Done 2026-09-25: all four destroyed; Secret Manager returns 404 for each.*
- [x] R10 Optionally remove `ssbmax.ai` from the Razorpay website list (Account & Settings) so the account reflects ActionStation and ai-borne only `(You)`. *Done 2026-09-25: nothing to remove; the Websites & API keys list shows only `https://www.actionstation.in` (Approved), `ssbmax.ai` is not on it.*
- [x] R11 Keep ActionStation's `notes.source` guard for now (harmless). Once R7-R9 are done, this file, checklist B12, and `PAYMENT-INCIDENTS.md` Runbook 5 drop the shared-account language `(Claude)`. *Done 2026-09-25 (this change).*

**Not affected:** ActionStation's live keys, webhook and drill (B24) were never touched by the retirement.

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
- Optional: disable secret v3 (test keys) once rollback is no longer wanted.
