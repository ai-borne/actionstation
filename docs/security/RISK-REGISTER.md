# Risk Register — Stripe Payment Integration

> **Status: Current** · Last reconciled: 2026-09-25 (R13 updated; other risks not re-scored). Update this line whenever you re-verify the doc against the code or live system.

> **System**: ActionStation Stripe payment integration
> **Date**: 29 March 2026
> **Version**: 1.0

---

## Risk Register

| # | Risk | Likelihood | Impact | Severity | Mitigation | Owner | Status |
|---|------|-----------|--------|----------|------------|-------|--------|
| R1 | Stripe webhook secret compromised | Low | Critical | **High** | Secret Manager + 90-day rotation + revocation runbook | DevOps | Open |
| R2 | Webhook delivery failure (Stripe outage) | Medium | High | **High** | Stripe retries 72h. Reconciliation runbook. `minInstances: 1`. | Backend | Open |
| R3 | Race condition in idempotency check | Low | Medium | **Medium** | Firestore transaction for idempotency write. Worst case: duplicate state write (idempotent). | Backend | Open |
| R4 | Cloud Function cold start delays webhook processing | Medium | Low | **Low** | `minInstances: 1` on webhook function. Stripe tolerates up to 20s. | Backend | Open |
| R5 | WAF false positive blocks Stripe webhook | Low | High | **Medium** | Webhooks verified by signature (not WAF). Monitor WAF logs for Stripe IP blocks. | DevOps | Open |
| R6 | Developer accidentally logs Stripe secret | Low | Critical | **High** | Structural test prevents secret references in code. `filterPromptOutput` scans. Code review. | Security | Open |
| R7 | Stripe publishable key used for unauthorized purposes | Low | Low | **Low** | Publishable keys are public by design. Cannot access sensitive operations. | — | Accepted |
| R8 | Subscription state drift (Firestore vs Stripe) | Low | Medium | **Medium** | `lastEventId` tracks latest event. Reconciliation script (Phase 3). | Backend | Open |
| R9 | DDoS on checkout endpoint | Medium | Medium | **Medium** | Cloud Armor + IP rate limit + user rate limit. Stripe has own DDoS protection. | DevOps | Open |
| R10 | Key rotation causes service disruption | Low | High | **Medium** | Rotation runbook includes 24h soak period. Old version disabled (not destroyed) for 30 days. | DevOps | Open |
| R11 | Open redirect vulnerability in checkout URLs | Low | High | **Medium** | URLs hardcoded server-side. No user-controlled `successUrl`/`cancelUrl`. | Security | Resolved |
| R12 | `isActive` not checked in feature gating | Medium | High | **High** | `hasFeatureAccess()` now accepts `isActive` parameter. All callers updated. | Backend | Resolved |
| R13 | Turnstile CAPTCHA not deployed | Medium | Medium | **Low** | Deployed: site key in live bundle, `verifyturnstile` returned 200 in production (checklist E6, 2026-09-20). | Frontend | Mitigated |
| R14 | Stripe keys not in Secret Manager | Low | Critical | **High** | `setup-stripe-secrets.sh` script ready. Manual execution required. | DevOps | Open |
| R15 | No monitoring alerts for payment failures | Medium | Medium | **Medium** | `setup-monitoring-alerts.sh` exists. Needs execution + payment-specific additions. | DevOps | Open |

---

## Risk Heat Map

```
            Low Impact   Medium Impact   High Impact   Critical Impact
High Prob     R9            R2                           R6
Med Prob      D4            R3,R13,R15                   R14
Low Prob      R7,R4         R5,R8,R10                    R1,R11,R12
```

---

## Mitigation Status

| Status | Count |
|--------|-------|
| Resolved (code fix) | 2 (R11, R12) |
| Open (requires ops action) | 13 |
| Accepted (risk accepted) | 1 (R7) |

---

## Escalation Matrix

| Scenario | First Responder | Escalation | SLA |
|----------|----------------|------------|-----|
| Webhook secret compromised | DevOps | Security Lead | <30 min |
| Webhook delivery failure >1h | Backend | DevOps | <15 min |
| Checkout endpoint 5xx spike | Backend | DevOps | <15 min |
| Subscription state drift | Backend | Product | <4 hours |
| Secret leakage in code/logs | Security | DevOps + Backend | <15 min |

---

*Last reviewed: 29 March 2026*
*Next review: Launch + 30 days*
