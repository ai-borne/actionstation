# Docs Map

> **Status: Current** · Last reconciled: 2026-09-25 (index; enforced by `src/__tests__/docsIntegrity.structural.test.ts`).

Start here. One place per topic; each folder has a single "current state" doc where it matters.
Update the **Last reconciled** date in a doc whenever you verify it against the live system.

## Read first every sprint
| Doc | What it is |
|-----|-----------|
| [`launch/LAUNCH-CHECKLIST.md`](launch/LAUNCH-CHECKLIST.md) | Single source of truth for launch: status table, blockers (B/D/E/G/I items), dated evidence. Tick with evidence only |
| [`launch/LAUNCH-EVIDENCE.md`](launch/LAUNCH-EVIDENCE.md), [`launch/LAUNCH-CHANGELOG.md`](launch/LAUNCH-CHANGELOG.md) | Archives: long per-item evidence and dated history moved out of the checklist. Append there, keep one-liners in the checklist |
| [`payments/PAYMENT-STATE.md`](payments/PAYMENT-STATE.md) | Current Razorpay state: mode per app, webhooks, routing, open items |

## By topic
| Folder | Contents |
|--------|----------|
| `payments/` | `PAYMENT-STATE.md` (current), `RAZORPAY-SHARED-ACCOUNT-GUIDANCE.md` (background advice, with corrections) |
| `runbooks/` | Procedures: `PAYMENT-INCIDENTS.md` (6 runbooks incl. key rotation), `PAYMENT-E2E-DRILL.md`, `FIRESTORE-RESTORE.md`, `GOOGLE-OAUTH-VERIFICATION.md` |
| `security/` | `THREAT-MODEL.md`, `RISK-REGISTER.md`, `KEY-LIFECYCLE.md` |
| `compliance/` | `PCI-SAQ-A.md`, `TECH-DEBT-2026-02-07.md` (old debt audit, historical) |
| `mobile/` | `KMP-MOBILE-PLAN.md` (undecided, checklist G2) |
| top level | `UPTIME-MONITORING.md`, `OAUTH_MIGRATION_GUIDE.md`, `scaling-guide.md` |
| `../plans/` | Roadmap: `PRODUCTION-LAUNCH-PLAN.md` and phase plans. Can be stale; the checklist wins |
| `../mydocs/` | Older per-phase feature plans (phases 1-11, audits) |

## Conventions
- Current state goes in the folder's state doc; dated evidence goes in the checklist.
- Never put secrets or key values in docs.
- Cross-site copy uses `ssbmax.ai`, never `ssbmax.in`.
- Files use `.md` and UPPER-KEBAB names.
