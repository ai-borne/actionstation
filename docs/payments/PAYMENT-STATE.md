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

## SSBMax facts (read from the SSBMax repo `origin/main`, 2026-09-25; re-verify before acting)

- Firebase project `ssbmax-49e68`. Webhook `handleRazorpayWebhook` (`webhooks.js`), secret `RAZORPAY_WEBHOOK_SECRET`. Order and subscription functions read `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from Firebase secrets.
- SSBMax sells **subscriptions** (Razorpay Subscriptions, monthly per tier) plus a legacy one-time `payment.captured` path. Mobile purchases go through RevenueCat, which is separate from Razorpay.
- Plan IDs come from the JSON secret `RAZORPAY_PLAN_IDS`. **Razorpay plan IDs are per mode**, so test plan IDs do not exist in live mode. This is the biggest go-live item.
- SSBMax does **not** stamp `notes.source` on its own orders or subscriptions; it sends `notes = { userId, planId }`. It only *ignores* events stamped `actionstation` (`razorpayForeignEvent.js`). No source means "SSBMax's own". ActionStation ignores anything not stamped `actionstation`, so the unstamped SSBMax events are already safe on our side.
- Its webhook has a 12-event set (subscription lifecycle, `payment.captured`, `refund.processed`). Mirror the test webhook's list for live.

## SSBMax go-live checklist

Work happens in the **SSBMax repo** (its code, its Firebase project, its secrets). This repo only holds the shared state above. Tick items here with evidence as they are done. Owner tags: `(You)` = your accounts or money; `(Claude)` = code or docs work.

**A. Before touching secrets**
- [ ] S1 Razorpay **live Subscriptions** are enabled on the account. Check the dashboard (Live view, Subscriptions). If not, request activation from Razorpay; this can take days `(You)`.
- [ ] S2 SSBMax pricing and legal pages meet Razorpay review: INR price visible before checkout, Privacy, Terms, Refund & Cancellation, Contact in the footer on `ssbmax.ai` (checked live 2026-09-24; re-check after any SSBMax redesign) `(You)`.
- [ ] S3 Decide the live plans and prices from SSBMax's `pricing.yaml` (which tiers are sold in live) `(You)`.
- [ ] S4 Confirm SSBMax code has no test-mode assumption: the `rzp_test_mockKey123` fallback is emulator-only, production throws if secrets are missing `(Claude)`.

**B. Live setup in Razorpay (Live view)**
- [ ] S5 Create the **live plans** (one per sold tier, monthly), note each live `plan_...` id `(You)`.
- [ ] S6 Create SSBMax's **live webhook**: URL `https://us-central1-ssbmax-49e68.cloudfunctions.net/handleRazorpayWebhook`, the same 12 events as its test webhook (open the test webhook and mirror it), a **new** secret `(You)`.

**C. Secrets (SSBMax Firebase project; never paste values into chat)**
- [ ] S7 Add new versions of `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` with the **live** pair (the same pair ActionStation uses; read it from the Razorpay dashboard or ActionStation's Secret Manager in your own terminal). Do **not** regenerate it (it would break ActionStation checkout, B13). Keep the test versions enabled for rollback `(You)`.
- [ ] S8 Set `RAZORPAY_PLAN_IDS` to a JSON map of SSBMax plan keys to the live `plan_...` ids from S5 `(You)`.
- [ ] S9 Add a new version of `RAZORPAY_WEBHOOK_SECRET` with the live webhook secret from S6 `(You)`.
- [ ] S10 Redeploy every SSBMax function that reads these secrets (functions pin a secret version at deploy). Verify the pinned versions with `gcloud run services describe` `(You)`.

**D. Proof (small real payment, like ActionStation's B24)**
- [ ] S11 Pay the cheapest live plan with a real payment; check the subscription webhook returns 200 and the user's tier updates in Firestore `(You)`.
- [ ] S12 Confirm the **cross-app filter live**: an ActionStation live event in SSBMax's logs shows "belongs to another app on the shared account -- acknowledged" and returns 200, and touches no SSBMax user `(You)`.
- [ ] S13 Cancel the subscription and issue a full refund from the dashboard; check `subscription.cancelled` and `refund.processed` return 200 and the user returns to Free `(You)`.
- [ ] S14 Run one ActionStation drill-level check after S10: ActionStation checkout still works and its webhook is unaffected `(You)`.

**E. Afterwards**
- [ ] S15 Update this file: mode table (SSBMax LIVE), webhook table (SSBMax live webhook), remove the SSBMax TEST notes `(Claude)`.
- [ ] S16 Optional, in SSBMax: stamp `notes.source = 'ssbmax'` on its orders and subscriptions, and treat unknown sources as foreign. Not needed for safety today; makes the shared account cleaner if a third product joins `(Claude)`.
- [ ] S17 Shared-key rule: from now on regenerating the live key needs both apps updated and redeployed at once. Record the coordination in `PAYMENT-INCIDENTS.md` Runbook 5 `(Claude)`.
- [ ] S18 Disable the old test secret versions in SSBMax once you are confident there is no rollback to test mode `(You)`.

**Rollback:** re-enable the previous (test) secret versions and redeploy the SSBMax functions. Live payments already taken stay in Razorpay and must be refunded from the dashboard.

## Risks to watch

- Order notes carry `userId` and `planId` in the same shape across apps; `notes.source` is the only separator.
- A browser holding an old service worker needs one reload after a deploy (HTML is no-cache).
- Payments carry customer email/phone from the other product in cross-delivered payloads.

## Open

- B9 GST / invoicing decision.
- B17 stuck test refund `pay_TeCo0SIEDxJ29q` (test money only).
- D2 human review of Terms and Privacy (entity name, address, DPDP).
- D5 PCI SAQ-A sign-off (`docs/compliance/PCI-SAQ-A.md`).
- SSBMax live go-live (checklist S1-S18 above) and live proof of its filter.
- Optional: disable secret v3 (test keys) once rollback is no longer wanted.
