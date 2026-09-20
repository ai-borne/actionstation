# Payment Incident Runbook (Razorpay)

> **Version**: 2.0 | **Date**: 20 September 2026
> **Scope**: Razorpay one-time **annual** plan (₹2,999, 365 days of Pro). Stripe is deferred (checklist H2);
> its functions stay deployed but no client path reaches them (`noStripeUi.structural.test.ts`).
> **Review cadence**: Quarterly

## Facts every runbook depends on

| Fact | Value |
|------|-------|
| GCP project | `actionstation-244f0` — **always pass `--project`**; the gcloud default on the maintainer machine is a different project |
| Region / runtime | `us-central1`, gen2 (Cloud Run). Log filter: `resource.type="cloud_run_revision"`, lowercase `service_name` (`razorpaywebhook`, `createrazorpayorder`) |
| Webhook URL | `https://razorpaywebhook-hirwmylcjq-uc.a.run.app` (public invoker; protected by HMAC signature) |
| Events handled | `payment.captured`, `refund.processed` (plus `subscription.*`, unused at launch) |
| Payer identity | Resolved from the **order notes** set by `createRazorpayOrder` (`orders.fetch`), never from payment notes. Only orders stamped `notes.source = actionstation` are ours |
| Shared Razorpay account | The account is shared with **SSBMax** (`ssbmax-49e68`). Razorpay delivers every account event to every registered webhook, so we receive SSBMax payments/subscriptions too. They are ignored with an info log (`not an ActionStation order — ignored`), never an alert |
| Price SSOT | `functions/src/utils/razorpayPricing.ts` (paise). Client copy is derived from `PRO_ANNUAL_PRICE_INR`; a structural test keeps them equal |
| Secrets | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` in Secret Manager. **Functions pin a secret VERSION at deploy** — a new version is not used until the function is redeployed |
| User subscription doc | `users/{uid}/subscription/current` (server writes only). Pro is honoured server-side only while `isActive !== false` and `expiresAt` is in the future (`effectiveTier.ts`) |
| Retained payment record | `paymentRecords/{paymentId}` — written when a user deletes their account with an active annual plan (server-only, rules deny all client access) |
| Alerts | `HIGH: Webhook Processing Error` and `CRITICAL: Webhook Signature Failure Spike` on channel `Eden Alerts` (see `docs/UPTIME-MONITORING.md`, `scripts/setup-monitoring-alerts.sh`) |

Read-only log query used throughout (replace the filter as needed):

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="razorpaywebhook"' \
  --project=actionstation-244f0 --freshness=1d --limit=50 \
  --format='value(timestamp,jsonPayload.message)'
```

---

## Runbook 1: Payment made but user is not Pro

**Trigger**: user reports paying and still seeing Free, or a `HIGH: Webhook Processing Error` alert (this now fires only for ActionStation-side failures, not for SSBMax traffic).

1. Find the payment in **Razorpay Dashboard → Transactions → Payments** (note the `pay_…` id, `order_…` id, status `captured`).
2. Check the webhook log for that payment id (query above, add `AND "pay_XXXX"`).
   - `Handler failed: …` → the event returned 500; Razorpay retries for ~24 h, fix and let it retry.
   - `not an ActionStation order — ignored` (INFO) → the payment belongs to another product on the shared account (e.g. SSBMax). Expected; nothing to do. If the user says they paid ActionStation, check the payment description and its order notes in Razorpay: a missing `source: actionstation` means it did not go through our checkout.
   - `payment.captured: ActionStation order has no userId` → a genuine bug (our order without an owner). Acknowledged (200) and not retried; nothing was granted. Find the user from the payment email, then go to step 4.
   - `plan not purchasable or amount below plan price` → the order was not for the annual plan, or under-paid. Nothing granted; refund or contact the user.
   - No log entry at all → delivery problem, see Runbook 2.
3. Check the user's doc: `users/{uid}/subscription/current` should show `tier: pro`, `isActive: true`, `lastEventId: pay_…`, `expiresAt` ≈ payment time + 365 days.
4. To grant manually after confirming a real payment for that user: in **Razorpay → Payments → the payment → Notes/Order** confirm the order's `userId`. Then re-deliver the event from **Dashboard → Settings → Webhooks → your endpoint → Recent deliveries → Resend**. The idempotency claim is released after a failed handler, so a resend is processed normally. Never edit the subscription doc by hand unless resend is impossible; if you must, set `provider: 'razorpay'`, `lastEventId` to the payment id and `expiresAt` to payment time + 365 days.

## Runbook 2: Webhook delivery failure

**Trigger**: payments succeed in Razorpay but no `razorpaywebhook` log entries; or Razorpay shows deliveries failing.

1. **Razorpay Dashboard → Settings → Webhooks → endpoint → Recent deliveries**. Note the HTTP status returned.
   - `400` → signature mismatch: the dashboard webhook secret differs from `RAZORPAY_WEBHOOK_SECRET` **as deployed**. Go to Runbook 5, step "Webhook secret".
   - `500` → handler error, see Runbook 1.
   - `403/404` → service or IAM issue: `gcloud run services describe razorpaywebhook --region us-central1 --project actionstation-244f0` and check `roles/run.invoker` includes `allUsers`.
2. Confirm the deployed revision is healthy and recent: `gcloud run revisions list --service razorpaywebhook --region us-central1 --project actionstation-244f0 --limit 3`.
3. If Cloud Armor is ever enabled (checklist C6/C7 decision), confirm it does not block Razorpay's source IPs.
4. Recovery: fix the cause, then **Resend** missed deliveries from the Razorpay dashboard. The idempotency guard makes replays safe.

## Runbook 3: Refund (annual plan, 7-day full refund)

**Policy** (`REFUND_WINDOW_DAYS` in `subscription.ts`): full refund on request within 7 days of payment. Terms and FAQ state it. Refunds are issued by a human from the Razorpay dashboard — there is no self-serve refund.

1. Confirm the request is within 7 days of the **payment date** and identify the payment (`pay_…`) from the user's email address in **Razorpay → Payments**.
2. **Razorpay Dashboard → Payments → the payment → Refund → Full refund**.
3. Razorpay sends `refund.processed`. The webhook downgrades the user to Free **only if** the refunded payment is the one currently granting Pro (`lastEventId`), so a refund of an old payment never revokes a newer purchase. **Partial refunds keep Pro** and are logged as `Partial refund — Pro retained`.
4. Verify in logs: `Full refund — downgraded to free`, and the user's doc shows `tier: free`, `isActive: false`.
5. Reply to the user. Bank settlement takes Razorpay's normal 5–7 working days.

**Outside the window or by law** (e.g. duplicate charge): refund the same way; the same webhook downgrades. Record the reason in the incident log.

## Runbook 4: Account deleted with an active plan

Deleting an account **does not refund** the plan (the confirm dialog says so). The deletion still completes, and a record `paymentRecords/{paymentId}` (payment id, uid, plan, currency, expiry, reason, timestamp) is kept for refund review and tax records.

1. Find such cases: `gcloud logging read 'jsonPayload.message:"payment record retained"' --project actionstation-244f0 --freshness=30d`.
2. If the user asks for a refund within the window, refund per Runbook 3. The `refund.processed` event will find no subscription doc to downgrade; that is expected and harmless.
3. If retention fails, the deletion is **aborted** (`subscriptionCancelled: false`, message "could not settle billing"). Check the log line `Payment record could not be retained: …` and retry.

## Runbook 5: Switching to live keys, or rotating any Razorpay secret

> Do this only when the owner has completed Razorpay KYC and approved go-live (checklist B1/B3). **Never paste keys into chat, tickets or the browser tools.** Use your own terminal.

Because functions pin a secret **version** at deploy, adding a version alone changes nothing.

1. **Key id / secret**: `./scripts/setup-payment-secrets.sh` (silent prompts) or
   `printf %s "$VALUE" | gcloud secrets versions add RAZORPAY_KEY_ID --data-file=- --project actionstation-244f0`.
2. **Webhook secret**: in Razorpay **live mode → Settings → Webhooks**, add the endpoint above with events `payment.captured` and `refund.processed`, choose a strong secret, and store the same value as a new `RAZORPAY_WEBHOOK_SECRET` version. Test mode and live mode have **separate** webhook registrations and keys.
3. **Redeploy** so the new versions are picked up: merge to `main` (CI deploys) or
   `firebase deploy --only functions:razorpayWebhook,functions:createRazorpayOrder,functions:onUserDeleted --project actionstation-244f0`.
4. Verify the pinned versions: `gcloud run services describe razorpaywebhook --region us-central1 --project actionstation-244f0 --format=yaml | grep -A3 RAZORPAY`.
5. Prove the webhook secret matches: in the Razorpay dashboard resend a recent delivery from **Recent deliveries**, or make a small real payment, and confirm the delivery shows `200`.
6. Run the drill in `docs/runbooks/PAYMENT-E2E-DRILL.md` with a small real payment, then refund it (checklist B5).
7. Disable the previous secret versions after 24 h: `gcloud secrets versions disable N --secret=RAZORPAY_KEY_SECRET --project actionstation-244f0`.

**Suspected key compromise**: in the Razorpay dashboard regenerate the key (the old one stops working), then follow steps 1–4 immediately, then review **Razorpay → Payments** for unknown activity and Cloud Audit Logs for `AccessSecretVersion` on the three secrets.

## Runbook 6: Subscription state drift

**Trigger**: a user's tier disagrees with Razorpay.

| Razorpay says | Firestore says | Action |
|---------------|----------------|--------|
| Payment captured, order ours | Free | Runbook 1 (resend the event) |
| Payment fully refunded | Pro | Resend `refund.processed`; the webhook downgrades if `lastEventId` matches |
| Plan expired (payment + 365 days) | `tier: pro` | Nothing to fix: the client and `geminiProxy` treat an expired plan as Free via `expiresAt` |

## Escalation contacts

| Role | Primary | Backup |
|------|---------|--------|
| Owner / payments | mail.sunilpawar@gmail.com | — |

*Last reviewed: 20 September 2026 · Next review: launch + 30 days*
