# STRIDE Threat Model: Razorpay Payment Integration

> **System**: ActionStation Razorpay payments (`createRazorpayOrder`, `razorpayWebhook`, `onUserDeleted`)
> **Status: Current** · Last reconciled: 2026-09-25 (rewritten from the March 2026 Stripe model; checked against `functions/src/razorpayWebhook.ts` and `createRazorpayOrder.ts`). Owner review pending.
> **Methodology**: STRIDE. Current payment state: `docs/payments/PAYMENT-STATE.md`.

## System description

The user is authenticated with Firebase, `createRazorpayOrder` creates a server-priced order stamped `notes.source = actionstation`, and the Razorpay Checkout modal (hosted by Razorpay) collects payment. Razorpay then calls `razorpayWebhook` (`payment.captured`, `refund.processed`), which grants or removes Pro in Firestore. Card data never enters our infrastructure (`docs/compliance/PCI-SAQ-A.md`). The Razorpay account is **shared with SSBMax**, so foreign events reach our webhook.

## Data flow

```
User -> Firebase Auth -> createRazorpayOrder (bot, App Check, IP limit, auth, user limit)
     -> Razorpay Checkout modal -> payment
Razorpay -> razorpayWebhook (signature, idempotency, source filter) -> Firestore subscription/current
Client reads subscription state
```

## Threats

### S: Spoofing
| # | Threat | Component | Mitigation | Risk |
|---|--------|-----------|------------|------|
| S-1 | Fake webhook posing as Razorpay | `razorpayWebhook` | HMAC-SHA256 of the body checked against `x-razorpay-signature` with `RAZORPAY_WEBHOOK_SECRET`; missing or bad signature returns 400 | Low |
| S-2 | Order created for another user | `createRazorpayOrder` | Firebase ID token verified, uid taken server-side and put in order notes | Low |
| S-3 | Stolen Firebase ID token | `createRazorpayOrder` | Token expiry, IP and user rate limits, bot detection, App Check | Medium |
| S-4 | Bot impersonating a browser | All functions | `detectBot()`, App Check, Turnstile on login | Low |

### T: Tampering
| # | Threat | Component | Mitigation | Risk |
|---|--------|-----------|------------|------|
| T-1 | Webhook payload altered | `razorpayWebhook` | Signature covers the raw body | Low |
| T-2 | Client edits its subscription doc | Firestore | Rules deny client writes to the subscription doc | Low |
| T-3 | Client picks its own price | `createRazorpayOrder` | Price and plan validated server-side (`razorpayPricing.ts`, single source of truth) | Low |
| T-4 | Foreign app's event changes our users | `razorpayWebhook` | Only `notes.source = actionstation` is processed; others get 200 and are ignored (B12) | Low |

### R: Repudiation
| # | Threat | Component | Mitigation | Risk |
|---|--------|-----------|------------|------|
| R-1 | User denies paying | All | Razorpay records, Cloud Logging audit lines, `lastEventId`, server-only `paymentRecords` kept after account deletion | Low |
| R-2 | Duplicate webhook delivery | `razorpayWebhook` | Atomic idempotency claim per event id (`claimWebhookEvent`), duplicates return 200 "already processed" | Low |
| R-3 | Unauthorised key rotation | Secret Manager | Cloud Audit Logs | Low |

### I: Information disclosure
| # | Threat | Component | Mitigation | Risk |
|---|--------|-----------|------------|------|
| I-1 | Razorpay key secret in client bundle | Client | Secrets are server-side only; structural tests scan `src/` | Low |
| I-2 | Secrets in logs or Sentry | Functions, client | Security logger never records secret values; Sentry masks text and media | Low |
| I-3 | Card data in our systems | All | Razorpay-hosted checkout only (SAQ A) | N/A |
| I-4 | SSBMax customer email/phone reaches our webhook | `razorpayWebhook` | Shared account delivers all events; we ignore foreign events and do not store their payloads (B12) | Medium |

### D: Denial of service
| # | Threat | Component | Mitigation | Risk |
|---|--------|-----------|------------|------|
| D-1 | Fake webhook flood | `razorpayWebhook` | Signature check rejects fast; Cloud Armor WAF is **not deployed** (deferred, checklist C6) | Medium |
| D-2 | Order creation flood | `createRazorpayOrder` | IP and user rate limits, bot detection, App Check | Low |
| D-3 | Webhook delivery failure or cold start | Razorpay to function | Razorpay retries; `minInstances` is off pre-traffic (enable for the webhook once real traffic grows); returning 4xx for foreign events would risk the webhook being disabled, so they get 200 | Medium |

### E: Elevation of privilege
| # | Threat | Component | Mitigation | Risk |
|---|--------|-----------|------------|------|
| E-1 | Free user forces Pro features | Client | Server-side enforcement and rules; client gates are UX only | Low |
| E-2 | Refunded user keeps Pro | Webhook | `refund.processed` downgrades on a full refund of the current payment (B6a) | Low |
| E-3 | Late `payment.captured` retry re-grants Pro after a refund 

## Recommendations
1. Alert on webhook signature failures.
2. Decide on Cloud Armor (C6) and `minInstances` for the webhook when traffic grows.
3. Re-check this model when SSBMax goes live on the shared account, and quarterly per `KEY-LIFECYCLE.md`.
