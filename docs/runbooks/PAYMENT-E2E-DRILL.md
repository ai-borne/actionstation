# Payment End-to-End Drill

> **Status: Current** · Last reconciled: 2026-09-25 (live and test mode notes updated). Update this line whenever you re-verify the doc against the code or live system.

Proves the whole chain on `https://www.actionstation.in`: **order → payment → webhook → Pro → refund → Free → delete-with-plan**.
Run it in **test mode** after any payment change (checklist B2, B6, B7) and once in **live mode** with a small real payment (B5; done for ActionStation 2026-09-24 as B24). Current mode per app: `docs/payments/PAYMENT-STATE.md`.
Incident procedures live in `PAYMENT-INCIDENTS.md`.

**Who does what**: the account owner signs in and pays in their own browser (Google sign-in and card entry are never automated).
Everything else is read-only verification that anyone with gcloud access can run.

```bash
P=actionstation-244f0
UID_=<firebase uid of the test account>      # Firebase console → Authentication
TOKEN=$(gcloud auth print-access-token)
sub() { curl -s -H "Authorization: Bearer $TOKEN" \
  "https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents/users/$UID_/subscription/current"; }
logs() { gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"razorpaywebhook\"" \
  --project=$P --freshness=30m --limit=20 --format='value(timestamp,jsonPayload.message)'; }
```

Use a **throwaway Google account** for the delete step (step 7); it removes the account.

## 0. Preconditions (read-only)

- [ ] Deployed revision is the one under test: `gcloud run services describe razorpaywebhook --region us-central1 --project $P --format='value(status.latestReadyRevisionName,metadata.annotations)'`.
- [ ] Razorpay dashboard (correct mode) has the webhook registered at `https://us-central1-actionstation-244f0.cloudfunctions.net/razorpayWebhook` (or the equivalent `run.app` URL) with events `payment.captured` and `refund.processed`. Test-mode registration verified 2026-09-20; live mode has none yet.
- [ ] Live bundle price is right: the Settings upgrade button reads **₹2,999/year**, matching `razorpayPricing.ts`.

## 1. Baseline

- [ ] `sub` shows no document, or `tier: free`.
- [ ] Settings → Subscription shows **Free**, and the AI counter shows the free limit (60/day).

## 2. Order and payment (owner)

- [ ] Settings → **Upgrade to Pro** opens Razorpay Checkout for **₹2,999**.
- [ ] Pay with the Razorpay test card `4111 1111 1111 1111`, any future expiry, any CVV; complete the test-bank success page.
- [ ] Log line in Cloud Logging: `createrazorpayorder` "Razorpay order created" (`orderId` present).

## 3. Webhook and Pro unlock

- [ ] `logs` shows **no** `webhook_processing_error`; the delivery shows `200` in the `razorpaywebhook` log (`httpRequest.status`); the Razorpay dashboard has no delivery-history screen.
- [ ] `sub` shows `tier: pro`, `isActive: true`, `provider: razorpay`, `gatewayPlanId: plan_pro_annual_inr`, `lastEventId: pay_…`, and `expiresAt` = payment time + 365 days.
- [ ] Within ~2 s the app shows **Pro**; the AI counter shows the Pro limit (500/day) and free-tier node/workspace caps are lifted.
- [ ] Replay: the dashboard cannot resend an event, so this is covered by unit tests (`already processed` guard). A live replay only happens if Razorpay retries a delivery we already handled.

## 4. Negative checks (read-only / expected refusals)

- [ ] A payment that is **not** ours (a Razorpay payment link or an SSBMax test payment on the shared account) is acknowledged `200` and logged at INFO as `not an ActionStation order — ignored`; **no** `webhook_processing_error`, no alert email, no Firestore write.
- [ ] `POST createRazorpayOrder` with the old ₹100 plan id `plan_SWtIj1spzXCZbR` returns `400`.

## 5. Refund (B6)

- [ ] Razorpay → Payments → the payment → **Full refund**.
- [ ] Delivery `refund.processed` is `200`; logs show `Full refund — downgraded to free`.
- [ ] `sub` shows `tier: free`, `isActive: false`; the app shows **Free** after a reload.
- [ ] A **partial** refund test payment stays Pro and logs `Partial refund — Pro retained`.

## 6. Expiry (unit-tested; optional live check)

- [ ] Temporarily set the test account's `expiresAt` to a past time (owner/console only) → AI uses the free limit and the UI shows Free. Restore afterwards.

## 7. Delete account with an active plan (B7, throwaway account)

- [ ] Pay again (steps 2–3). Settings → **Delete Account** shows the Pro warning (no automatic refund).
- [ ] After deleting: `gcloud firestore` / REST `GET …/documents/paymentRecords/<pay_…>` returns the record with `reason: account_deleted_with_active_plan`; the `users/{uid}` tree is gone; Storage `users/{uid}/` is empty.
- [ ] A client read of `paymentRecords/<id>` is denied (rules deny all).
- [ ] Refund that payment (Runbook 3): `refund.processed` returns `200` and does not error on the missing user document.

## Record the result

Copy the timestamps, payment/order ids and log lines into the checklist evidence for B2/B6/B7 (and B5 for the live run).
