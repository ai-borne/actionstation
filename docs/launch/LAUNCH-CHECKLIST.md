# ActionStation — Launch Checklist (Single Source of Truth)

> **Goal: the Gold Standard web app for Building a Second Brain (BASB).**
> Every sprint starts by reading this file and ends by ticking boxes in it, with evidence.
> Last verified against live systems: **2026-09-19**

---

## How to use this document

1. **Sprint start:** read the *Status snapshot* and pick the open items for the sprint. Do not start work that is not listed here — add it first.
2. **During the sprint:** new blockers or discoveries are added immediately, with an ID, a milestone tag and a source.
3. **Sprint end:** tick `[x]`, and append the evidence (date, PR/commit, or "verified in console") to the item. Add a line to the *Change log*.
4. **Never tick from memory.** Tick only after verifying in code, CI, or the live system. Roadmap markdown can be stale; this file must not be.
5. **Owner tags:** `(Claude)` can be done in the repo/CLI. `(You)` needs your account, money, legal sign-off, or a human decision.

**Milestone tags**

| Tag | Milestone | Meaning |
|-----|-----------|---------|
| `M0` | Closed beta | Live on `www.actionstation.in`, invite-only, payments in **test mode**, not promoted |
| `M1` | Public India paid launch | Real payments, monitoring, legal and support in place |
| `M2` | Gold Standard | BASB product excellence, E2E-proven, scale-ready marketing |

---

## Status snapshot (2026-09-19)

| Area | State |
|------|-------|
| Code (`feature/launcher`) | Sprints 1–4, A, C complete. 625 test files / 17,110 tests pass |
| PR | [#51](https://github.com/ai-borne/actionstation/pull/51) open, **all CI checks green**, not merged |
| Production site | `www.actionstation.in` **live** but serving the **old 12 June build** |
| Domain / DNS | Connected in Firebase Hosting; apex `actionstation.in` → 301 → `www` |
| Payments | Razorpay in **TEST mode** (`rzp_test_`). Stripe secret is a **placeholder** (not launching) |
| WAF (Cloud Armor) | **Not deployed** (Compute API disabled). Deferred by decision |
| Monitoring alerts | 2 alert policies exist; `auth_failure_spike` / `bot_detected_spike` **missing** |
| Backups | Bucket `actionstation-244f0-firestore-backups` exists; immutability **unverified** |
| Uptime monitor | **None** |
| Support mailboxes | **None** (no MX records) — legal pages already promise them |

## Locked decisions

- **Domain:** canonical `https://www.actionstation.in`; apex redirects to it (2026-09-19)
- **Payments:** Razorpay only for launch; Stripe deferred
- **Hosting / storage:** Firebase Hosting + Firebase Storage. Revisit Cloudflare Pages / R2 only when the bill justifies it
- **WAF:** defer Cloud Armor (~$20–30/mo fixed); revisit Cloudflare-in-front vs Cloud Armor before M1 marketing
- **Launch timing:** no urgency; quality over date
- **`actionstation-website` folder:** unrelated AI-BORNE leftover; not part of this launch

---

## A. Release and deploy `M0`

- [x] A1 Domain connected: Firebase Hosting custom domains, Hostinger DNS, Auth authorized domains, OAuth origins/redirects — *2026-09-19*
- [x] A2 SEO files aligned to `www.actionstation.in` + structural test — *`7c02d8b`*
- [x] A3 CI green on PR #51 (gitleaks CLI, audit high/critical cleared, Lighthouse env) — *2026-09-19*
- [ ] A4 Merge PR #51 → production deploy (hosting, functions, rules, indexes) `(You)` approves, `(Claude)` monitors
- [ ] A5 Confirm new functions deployed: `gdprServerExport`, `onStorageObjectFinalized`, `onStorageObjectDeleted` (`firebase functions:list`)
- [ ] A6 Confirm live headers/SEO after deploy: canonical, sitemap, CSP includes `challenges.cloudflare.com`
- [ ] A7 Prod smoke test on `www.actionstation.in`: Google login, Turnstile, save, AI, link preview, upload, calendar connect, export, delete account
- [ ] A8 **Sign in once before 2026-10-13** — Google deletes the unused OAuth client (`190777323740-ccsb…`) after that date (satisfied by A7)
- [ ] A9 Confirm no debug flags in the prod bundle: `VITE_DEV_BYPASS_SUBSCRIPTION`, `VITE_APPCHECK_DEBUG_TOKEN`, dev Gemini key (`.env.local` has all three; CI builds must not)

## B. Payments — Razorpay `M1`

- [ ] B1 Start Razorpay **live activation / KYC now** (long lead time) `(You)`
- [ ] B2 Test-mode end-to-end: order → payment → webhook → Pro unlocked → AI limit lifted
- [ ] B3 Replace `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` with **live** keys in Secret Manager `(You)`
- [ ] B4 Live webhook registered at `razorpayWebhook` URL; `RAZORPAY_WEBHOOK_SECRET` matches
- [ ] B5 Real small live payment + refund drill
- [ ] B6 Cancel / refund flow for the annual model works without the Stripe portal
- [ ] B7 Delete-account with active Pro flags/cancels correctly (plan scenario 8)
- [ ] B8 Verify no Stripe UI path is reachable in production (secret is a placeholder)
- [ ] B9 GST / invoicing approach decided (Razorpay dashboard invoices vs automation) `(You)`
- [ ] B10 Payment runbook (`docs/runbooks/PAYMENT-INCIDENTS.md`) is Stripe-centric — add Razorpay procedures
- [ ] B11 Pricing, Terms and FAQ copy match actual tier limits (`tierLimits.ts` is the SSOT)

## C. Security and platform `M1`

- [ ] C1 App Check **enforcement** on Firestore, Storage, Functions — only after prod clients are verified to send tokens; reCAPTCHA key covers `www.actionstation.in` `(You)` console
- [ ] C2 Turnstile widget hostname allowlist includes `www.actionstation.in`; login smoke test passes `(You)` Cloudflare dashboard
- [ ] C3 Monitoring: run `scripts/setup-monitoring-alerts.sh`; add notification channels (email + chat); confirm `auth_failure_spike` and `bot_detected_spike`
- [ ] C4 Backups: confirm bucket is immutable (retention lock) per `scripts/setup-immutable-backups.sh`; verify a scheduled backup ran; **restore drill** once
- [ ] C5 Uptime monitor on `…/health` and on `https://www.actionstation.in` with email alerting (`docs/UPTIME-MONITORING.md`)
- [ ] C6 WAF decision recorded: Cloud Armor vs Cloudflare in front vs none for M1 (see Locked decisions)
- [ ] C7 Dependency audit: moderates remain (vitest 5 for dev tooling; `firebase-admin` 14 via `uuid`). Schedule upgrades; CLAUDE.md says audit 0
- [ ] C8 CSP `img-src` contains `data:` but CLAUDE.md forbids it — fix or record the exception
- [ ] C9 Secret hygiene per `docs/security/KEY-LIFECYCLE.md`; rotation dates recorded
- [ ] C10 GitHub Actions Node 20 deprecation warnings — bump action runtimes

## D. Legal, compliance and support `M1`

- [ ] D1 Mailboxes live: `support@`, `privacy@` (+ billing alias) at `actionstation.in`; MX + SPF + DKIM + DMARC `(You)`
- [ ] D2 Terms / Privacy reviewed by a human (entity name, address, grievance contact, India DPDP obligations) `(You)`
- [ ] D3 Cookie banner: reject → PostHog never captures, verified in prod (plan scenario 6)
- [ ] D4 GDPR export and account deletion verified end-to-end in prod
- [ ] D5 `docs/compliance/PCI-SAQ-A.md` reflects Razorpay-only checkout

## E. Pre-launch scenarios — verify on production `M1`

From the commercial-readiness plan; all must pass before M1.

- [ ] E1 Pro user after Razorpay payment is **not** limited to 60 AI/day
- [ ] E2 App Check enforced → AI generation works end-to-end
- [ ] E3 App Check enforced → link preview works (no direct-fetch fallback in prod)
- [ ] E4 Workspace with 1,200 nodes → save does not delete unseen nodes
- [ ] E5 Follower tab cannot lose data without a warning
- [ ] E6 Turnstile with site key set → login completes
- [ ] E7 Rules and functions deploy from CI on merge to `main` (pipeline, not manual)

## F. Resilience (plan Phase 7) `M1`

- [ ] F1 500+ node workspace: performance, spatial chunking, progressive loading
- [ ] F2 Three tabs editing: no data loss
- [ ] F3 Offline → online: queued saves flush; slow 3G has no timeout crashes
- [ ] F4 Browsers: Chrome, Firefox, Safari, Edge (latest 2); Chrome Android, Safari iOS; PWA install on both
- [ ] F5 Touch on canvas: pinch zoom, drag nodes
- [ ] F6 Accessibility: Lighthouse a11y 90+ (target 95+), keyboard-only flows, VoiceOver and NVDA passes

---

## G. Gold Standard for BASB `M2`

BASB = **C**apture → **O**rganize → **D**istill → **E**xpress. A feature belongs here only if it reduces friction between thought and capture, or between capture and insight. Targets marked *(proposed)* are starting points to confirm with you.

**Capture**
- [ ] G1 Capture-to-node latency and keystroke count measured; *(proposed)* under 2 s, fully keyboard-driven
- [ ] G2 Mobile capture path decided (evaluate `docs/Editors/mobile_platforms` and `.cursor/plans/kmp_mobile_input_pipeline_*`) `(You)` decision
- [ ] G3 Workspace templates: 5 built-ins (Project Plan, Research Canvas, Brainstorm, Weekly Review, BASB CODE) — plan 8.1
- [ ] G4 Blank-canvas activation: onboarding reaches "first useful node" quickly; funnel measured (needs consent-gated PostHog)

**Organize**
- [ ] G5 Tagging, Knowledge Bank and cluster suggestions reviewed against real BASB/PARA usage in beta
- [ ] G6 Search is fast at 500+ nodes and finds what users expect

**Distill**
- [ ] G7 Synthesis output quality reviewed on real beta content; prompts tuned; AI cost per active user tracked
- [ ] G8 AI failure states are graceful (limits, timeouts, safety filter) with clear copy

**Express**
- [ ] G9 Shareable read-only canvas link with expiry — plan 8.2
- [ ] G10 Markdown/branch export verified against real content
- [ ] G11 Landing page SEO: OG image, JSON-LD, prerendering decision (plan 5.2)

**Quality bars**
- [ ] G12 Playwright E2E suite for golden paths: sign-in, capture, save/reload, AI, upgrade, export, delete
- [ ] G13 Performance budgets enforced in CI (Lighthouse perf, bundle size, boot time)
- [ ] G14 In-app feedback + "report a bug" + changelog — plan 8.3
- [ ] G15 Closed beta with 5–10 real BASB practitioners; findings triaged into this file

## H. Growth (post-launch) `M2`

- [ ] H1 Referral / invite loop — plan 8.4
- [ ] H2 Stripe / global billing and tax — only if going beyond India
- [ ] H3 Revisit Cloudflare Pages / R2 and WAF choices against real cost data

## I. Housekeeping

- [ ] I1 Decide on untracked files: `.cursor/plans/kmp_mobile_input_pipeline_*.plan.md`, `.kilo/kilo.json`, `docs/Editors/` (commit or ignore)
- [ ] I2 Delete or archive `~/Downloads/actionstation-website` (unrelated AI-BORNE fragment) `(You)`
- [ ] I3 Retire stale plan docs or mark them "superseded by this checklist"
- [ ] I4 Update `PRODUCTION-LAUNCH-PLAN.md` status table to point here

---

## Change log

| Date | Change |
|------|--------|
| 2026-09-19 | Created. Domain connected (`www.actionstation.in`), SEO aligned, CI fixed, PR #51 green. Live-state audit: Razorpay test keys, no WAF, 2 alert policies, no uptime monitor, no mailboxes |
