# ActionStation — Launch Checklist (Single Source of Truth)

> **Goal: the Gold Standard web app for Building a Second Brain (BASB).**
> Every sprint starts by reading this file and ends by ticking boxes in it, with evidence.
> Last verified against live systems: **2026-09-24** (Razorpay live payment chain proven, B24); docs reconciled 2026-09-25 · Last reconciled: 2026-09-25
> Payments current state: [`docs/payments/PAYMENT-STATE.md`](../payments/PAYMENT-STATE.md). Docs map: [`docs/README.md`](../README.md)

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
| `M0` | Closed beta | Live on `www.actionstation.in`, invite-only, payments in **live mode** since 2026-09-24 (B24), not promoted |
| `M1` | Public India paid launch | Real payments, monitoring, legal and support in place |
| `M2` | Gold Standard | BASB product excellence, E2E-proven, scale-ready marketing |

---

## Status snapshot (reconciled 2026-09-25)

| Area | State |
|------|-------|
| Code (`main`) | Sprints 1–4, A, C, Sprint 1 (#54, `94ee7ef`) and Sprint 2 (#55, `1b57b3a`) merged and deployed 2026-09-20 (runs 35489583690, 35490056120): 627 test files / 17,133 tests + 522 functions tests pass |
| Production site | `www.actionstation.in` **live on the new build** (deployed 2026-09-20 06:47 IST). Hosting, 24 functions, rules and indexes deployed by CI |
| Domain / DNS | Connected in Firebase Hosting; apex `actionstation.in` → 301 → `www` |
| Payments | Razorpay in **LIVE mode** for ActionStation since 2026-09-24 (`rzp_live_`, Secret Manager v4; B3, B24 proven). SSBMax's Razorpay integration was **retired 2026-09-25** (store billing via RevenueCat), so the account is ActionStation-only. Earlier test-mode history follows. Stripe secret is a **placeholder** (not launching). **Proven end to end 2026-09-20 (Sprint 2b)**: order → payment → webhook 200 → Pro → refund → Free → delete-with-plan (B2, B4, B6, B7 ticked). Functions pin secret v3 (`razorpaywebhook-00013`, `createrazorpayorder-00013`, `onuserdeleted-00007`); v1/v2 disabled. Open: B16 (late `payment.captured` retry after a refund re-grants Pro), B1/B3/B5/B9 (yours); B12 closed 2026-09-25 |
| WAF (Cloud Armor) | **Not deployed** (Compute API disabled). Deferred by decision |
| Monitoring alerts | 9 enabled alert policies (+2 uptime policies) and 8 log metrics on channel `Eden Alerts` (email); `webhook_processing_error` alert added 2026-09-20. Fixed for gen2 on 2026-09-20 (were dead). **Email delivery proven (C3e, Sprint 3): the 06:02 UTC `webhook_processing_error` event produced an ALERT email at 06:06 UTC and a RESOLVED email at 06:11 UTC in the inbox** |
| Backups | **Working since 2026-09-20** (had failed with 403 before): daily export to `…-firestore-backups-immutable`, 30-day retention **unlocked**, restore drill passed. PITR off (C4e decision) |
| Uptime monitor | **Live 2026-09-20**: Cloud Monitoring checks on `www.actionstation.in` and `/health` (6 regions, 5 min), CRITICAL email alerts |
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
- [x] A4 Merge PR #51 → production deploy — *#51 merged `c56dee1`; first deploy failed at storage rules; #52 fixed it; deploy run 35480556053 succeeded 2026-09-20*
- [x] A5 New functions deployed: `gdprServerExport`, `onStorageObjectFinalized`, `onStorageObjectDeleted` — *`firebase functions:list` shows 24 functions, 2026-09-20*
- [x] A6 Live headers/SEO: canonical, sitemap, CSP includes `challenges.cloudflare.com`; apex 301 → www; `/terms`, `/privacy` 200; `/health` ok — *curl, 2026-09-20*
- [ ] A7 Prod smoke test on `www.actionstation.in`: → [evidence](LAUNCH-EVIDENCE.md#a7) — *Signed-out and signed-in flows are now covered on emulators (G12); a real-production smoke still needs a real Google sign-in `(You)`*
- [x] A10 **Google sign-in shows "Google hasn't verified this app" (found 2026-09-20, Sprint 2b, first sign-in of a throwaway account).** `(Claude for (a); You for (b))` → [evidence](LAUNCH-EVIDENCE.md#a10)
- [x] A10b Google OAuth verification for the opt-in Connect Calendar scope (still shows the warning and the 100-user cap; `(You)` → [evidence](LAUNCH-EVIDENCE.md#a10b) — *Owner confirmed complete 2026-09-25 (Google approved 2026-09-22; branding and data access verified, read 2026-09-24). The fresh-account "no unverified screen" check was reported done by the owner, not re-run by Claude*
- [x] A10c **No user-facing way to disconnect Google Calendar (found 2026-09-20, Sprint 3).** `(Claude, needs acceptance criteria)` → [evidence](LAUNCH-EVIDENCE.md#a10c)
- [x] A10d **Editing a card did not update its Google Calendar event (found 2026-09-20, Sprint 3; fixed in #75).** → [evidence](LAUNCH-EVIDENCE.md#a10d)
- [x] A8 **Sign in once before 2026-10-13** `(You)` → [evidence](LAUNCH-EVIDENCE.md#a8)
- [x] A9 No debug flags in the prod bundle: no dev-bypass flag, no embedded App Check debug token, no direct Gemini endpoint, no `rzp_test_`/`sk_` strings — *scanned live JS, 2026-09-20*
- [x] A10e **`calendarDeleteEvent` returns 500 when the Google event is already gone (found 2026-09-20, Sprint 4).** → [evidence](LAUNCH-EVIDENCE.md#a10e)

## B. Payments — Razorpay `M1`

- [x] B1 Start Razorpay **live activation / KYC now** (long lead time) `(You)` — *Done: Razorpay approved the website and KYC, live keys granted, bank account verified (see B3, B24; evidence 2026-09-24)*
- [x] B2 Test-mode end-to-end: order → payment → webhook → Pro unlocked → AI limit lifted — *Verified live 2026-09-20 (drill steps 2–3, third payment `pay_TeDdOA7N874UH3`): → [evidence](LAUNCH-EVIDENCE.md#b2)
- [x] B2a **Payer attribution (found 2026-09-20; corrected same day):** → [evidence](LAUNCH-EVIDENCE.md#b2a)
- [x] B2c **Revenue hole (found 2026-09-20):** → [evidence](LAUNCH-EVIDENCE.md#b2c)
- [x] B2d **Pro never expires server-side (found 2026-09-20):** → [evidence](LAUNCH-EVIDENCE.md#b2d)
- [x] B2b **Price mismatch (found 2026-09-20):** → [evidence](LAUNCH-EVIDENCE.md#b2b)
- [x] B6a `refund.processed` is not handled, so a refunded user stays Pro. → [evidence](LAUNCH-EVIDENCE.md#b6a)
- [x] B7a Account deletion with an active annual plan only logs "manual refund review" and then deletes the subscription doc, losing the payment trail. → [evidence](LAUNCH-EVIDENCE.md#b7a)
- [x] B3 Replace `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` with **live** keys in Secret Manager `(You)` — done 2026-09-24 (live keys v4, functions redeployed, proven by B24) → [evidence](LAUNCH-EVIDENCE.md#b3)
- [x] B24 **Live-mode payment proof (₹1 payment, webhook 200, refund) `(You)`.** → [evidence](LAUNCH-EVIDENCE.md#b24)
- [x] B4 (test mode) Webhook registered at `razorpayWebhook` URL; → [evidence](LAUNCH-EVIDENCE.md#b4)
- [x] B5 Real small live payment + refund drill — *Done as B24 (2026-09-24, ₹1 pay, webhook 200, refund, downgrade). SSBMax's live-side filter log will never be observed: SSBMax retired its Razorpay integration 2026-09-25 (see B12)*
- [x] B6 Cancel / refund flow for the annual model works without the Stripe portal — *Verified live 2026-09-20 (test mode): → [evidence](LAUNCH-EVIDENCE.md#b6)
- [x] B7 Delete-account with active Pro flags/cancels correctly (plan scenario 8) → [evidence](LAUNCH-EVIDENCE.md#b7)
- [x] B8 Verify no Stripe UI path is reachable in production (secret is a placeholder) → [evidence](LAUNCH-EVIDENCE.md#b8)
- [ ] B9 GST / invoicing approach decided (Razorpay dashboard invoices vs automation) `(You)`
- [x] B10 Payment runbook (`docs/runbooks/PAYMENT-INCIDENTS.md`) is Stripe-centric — add Razorpay procedures — *`docs/runbooks/PAYMENT-INCIDENTS.md` rewritten for Razorpay (v2.0, 6 runbooks incl. refund, live-key switch and the pinned-secret-version gotcha) and `PAYMENT-E2E-DRILL.md` added; log lines and alert names checked against the live project, 2026-09-20*
- [x] B11 Pricing, Terms and FAQ copy match actual tier limits (`tierLimits.ts` is the SSOT) → [evidence](LAUNCH-EVIDENCE.md#b11)
- [x] B12 **Razorpay account was shared with SSBMax: CLOSED 2026-09-25.** SSBMax's Razorpay integration is fully retired (store billing via RevenueCat, which does not support Razorpay): functions, secrets and test webhook deleted, legacy docs reset (R1-R11 all done in `docs/payments/PAYMENT-STATE.md`). The account is ActionStation-only; the live webhook keeps 7 events deliberately and the `notes.source` guard stays. See `docs/payments/PAYMENT-STATE.md` `(You)` → [evidence](LAUNCH-EVIDENCE.md#b12)
- [x] B13 **ActionStation checkout is broken: Razorpay rejects our test API key (found 2026-09-20 during the drill).** `(You)` → [evidence](LAUNCH-EVIDENCE.md#b13)
- [x] B14 **Razorpay Checkout cannot open in production: CSP `frame-src` lacks `https://api.razorpay.com` (found 2026-09-20 in the drill, right after B13).** → [evidence](LAUNCH-EVIDENCE.md#b14)
- [x] B14a Two more Razorpay hosts were blocked in the same drill: → [evidence](LAUNCH-EVIDENCE.md#b14a)
- [x] B14b Stale CSP for returning users: the service worker caches the page shell with its headers and only re-checks on navigation, so a tab left open never showed the update prompt. `swUpdateScheduler.ts` now re-checks hourly and when the tab becomes visible (hook wired, 4+2 tests) — *PR #61 merged; deploy run 35497763588 succeeded (attempt 2, see C14)*
- [x] B15 **Webhook deliveries are rejected: the dashboard's webhook secret does not match Secret Manager (found 2026-09-20 in the drill).** → [evidence](LAUNCH-EVIDENCE.md#b15)
- [x] B16 **A late `payment.captured` retry after a refund re-grants Pro (found 2026-09-20).** `(Claude, code + PR)` → [evidence](LAUNCH-EVIDENCE.md#b16)
- [ ] B17 One test refund is stuck: `pay_TeCo0SIEDxJ29q` (₹2,999, 12:46 IST) is still captured; the Razorpay test-mode dashboard rejects its full refund with "invalid request sent" (tried twice). Test money only. Retry later or raise it with Razorpay support; if it is refunded later the webhook must answer 200 and change nothing (its payment is not `lastEventId`) `(You)`
- [x] B22 **Stale app shell after a deploy (found 2026-09-24 while verifying B18).** → [evidence](LAUNCH-EVIDENCE.md#b22)
- [x] B23 SSBMax footer/pages (raised 2026-09-24): the web footer had no Contact page with phone and address, and no standalone refund page. → [evidence](LAUNCH-EVIDENCE.md#b23)
- [x] B18 **`/contact` was a dead link (found 2026-09-24, from the Razorpay guidance review).** → [evidence](LAUNCH-EVIDENCE.md#b18)
- [x] B19 **No standalone Refund & Cancellation page (found 2026-09-24).** → [evidence](LAUNCH-EVIDENCE.md#b19)
- [x] B20 **Signed webhook with no payment/refund/subscription entity returned 400 (found 2026-09-24).** → [evidence](LAUNCH-EVIDENCE.md#b20)
- [ ] B21 **Checkout should name the merchant (2026-09-24).** `(You)` → [evidence](LAUNCH-EVIDENCE.md#b21)

## C. Security and platform `M1`

- [x] C1 App Check **enforcement** on Firestore, Storage, Functions — only after prod clients are verified to send tokens; `(You)` → [evidence](LAUNCH-EVIDENCE.md#c1)
- [x] C2 Turnstile widget hostname allowlist includes `www.actionstation.in`; `(You)` → [evidence](LAUNCH-EVIDENCE.md#c2)
- [x] C3 Monitoring: `scripts/setup-monitoring-alerts.sh` run; → [evidence](LAUNCH-EVIDENCE.md#c3)
- [x] C3e **Alert email delivery (raised 2026-09-20, Sprint 2b as "never arrived"; resolved 2026-09-20, Sprint 3: it did arrive).** → [evidence](LAUNCH-EVIDENCE.md#c3e)
- [x] C3a **Dead monitoring (found 2026-09-20):** → [evidence](LAUNCH-EVIDENCE.md#c3a)
- [x] C3b gcloud default project on this machine is `payslip-app-475e1`; scripts must always pass `--project` explicitly (they do; keep it that way) — *verified in script, 2026-09-20*
- [x] C3c Razorpay test payments 2026-08-28/29 produced 31 `webhook_processing_error` events (`payment.captured: → [evidence](LAUNCH-EVIDENCE.md#c3c)
- [x] C3d **No alert on `webhook_processing_error` (found 2026-09-20):** → [evidence](LAUNCH-EVIDENCE.md#c3d)
- [ ] C4 Backups: confirm bucket is immutable (retention lock) → [evidence](LAUNCH-EVIDENCE.md#c4)
- [x] C4a **Backups have never worked (found 2026-09-20):** → [evidence](LAUNCH-EVIDENCE.md#c4a)
- [x] C4b Deployed code targets `gs://actionstation-244f0-firestore-backups-immutable`, which **does not exist**. The legacy bucket is empty (0 objects), has no retention policy, no versioning, uniform access off, and a 30-day delete lifecycle — *fixed 2026-09-20: bucket created and verified with `gcloud storage buckets describe`; objects present under `2026-09-20/`*
- [x] C4c `scripts/setup-immutable-backups.sh` is broken for macOS (`${CONFIRM,,}` needs bash 4), grants the wrong SA, swallows errors, uses `/tmp` and deprecated `gsutil`; rewrite it so locking is a separate, explicit step — *rewritten 2026-09-20: idempotent, `gcloud storage`, `mktemp`, correct SAs, no lock step (lock command printed only). Stale header comment in `firestoreBackup.ts` fixed*
- [x] C4d No alert exists for a failed backup — it failed silently at least once (the >50/min 5xx alert cannot catch a once-a-day job). Add a `firestore_backup_failed` log metric + alert — *2026-09-20: `firestore_backup_failed` metric + policy `HIGH: Firestore Backup Failed` created via `setup-monitoring-alerts.sh`*
- [ ] C4e Firestore PITR is **disabled** (version retention 1 h) and there is no managed backup schedule. Decide: enable PITR (7-day window, extra storage cost) and/or a managed daily schedule as a second layer `(You)` decision
- [ ] C4g **Lock the retention policy** on `…-firestore-backups-immutable` — IRREVERSIBLE; recommended only after 2–3 scheduled nightly backups have succeeded. Command in `docs/runbooks/FIRESTORE-RESTORE.md` `(You)` decision
- [ ] C4h Delete the empty legacy bucket `actionstation-244f0-firestore-backups` (or leave; it costs nothing) `(You)`
- [x] C4f Restore drill runbook `docs/runbooks/FIRESTORE-RESTORE.md` — restore into a scratch database, never into `(default)` — *2026-09-20: runbook added; drill restored into scratch DB `restore-drill`, counts matched `(default)` (workspaces 21, nodes 185, edges 84, knowledgeBank 33, usage 1); scratch DB deleted*
- [x] C5 Uptime monitor on `…/health` and on `https://www.actionstation.in` with email alerting (`docs/UPTIME-MONITORING.md`) → [evidence](LAUNCH-EVIDENCE.md#c5)
- [ ] C6 WAF decision recorded: Cloud Armor vs Cloudflare in front vs none for M1 (see Locked decisions)
- [x] C7 Dependency audit: moderates remain (vitest 5 for dev tooling; `firebase-admin` 14 via `uuid`). Schedule upgrades; CLAUDE.md says audit 0 — *Sprint 3 measurement 2026-09-20 (`npm audit`): root 2 moderate, functions 10 moderate, 0 high/critical (CI's audit gate passes at high). Nothing changed; upgrades still to schedule* — *2026-09-25: root `vitest` 5 (+ jest-dom typing shim, `vi.fn` constructor mocks) and functions `overrides.uuid ^11.1.1`; `npm audit` 0 in both packages, 18,047 root and 580 functions tests pass*
- [ ] C8 CSP `img-src` contains `data:` but CLAUDE.md forbids it — fix or record the exception — *Sprint 3 finding 2026-09-20: `(Claude, needs acceptance criteria)` → [evidence](LAUNCH-EVIDENCE.md#c8)
- [ ] C9 Secret hygiene per `docs/security/KEY-LIFECYCLE.md`; rotation dates recorded
- [x] C14 **Flaky unit test blocks production deploys (found 2026-09-20).** `(Claude, small PR)` → [evidence](LAUNCH-EVIDENCE.md#c14)
- [x] C15 **Production AI runs on a preview model (found 2026-09-20, Sprint 3).** `(You)` → [evidence](LAUNCH-EVIDENCE.md#c15)
- [x] C16 **A later merge cancelled the earlier merge commit's CI on `main` (found 2026-09-20, Sprint 3).** `(Claude)` → [evidence](LAUNCH-EVIDENCE.md#c16) — *Proven 2026-09-25: merges 2.4 min apart (`aab4daa`, `0a6bcde`, 2026-09-24) and 4.5 min apart (`ac7824d`, `6054fcd`, 2026-09-23) each ran overlapping CI (6–8 min) and all four finished `success`*
- [ ] C17 **`main` is not branch-protected (found 2026-09-20, Sprint 3).** `(You)` → [evidence](LAUNCH-EVIDENCE.md#c17)
- [ ] C18 **Returning visitors keep running an old app version until they click "Update now" (found 2026-09-23).** `(Claude, TDD)` — *Fix merged in #97 (`ef921b7`): signed-out tabs apply at once; signed-in tabs apply when hidden or idle 5 min with no save in flight. Not ticked until a deploy shows a hidden signed-in tab updating without a click* → [evidence](LAUNCH-EVIDENCE.md#c18)
- [x] C10 GitHub Actions Node 20 deprecation warnings — bump action runtimes — *2026-09-25: checkout/setup-node/upload-artifact v7, google-github-actions auth/setup-gcloud v3, lighthouse-ci-action v12 (all `using: node24`); guarded by `ciActionRuntimes.structural.test.ts`. Confirm the first CI run on the PR is green before merge*
- [x] C11 `firebase-tools` pinned (broke `storage:rules` in v15) — *2026-09-20: `FIREBASE_TOOLS_VERSION: '15.30.2'` in `deploy.yml` and `ci.yml`, every `npx` invocation uses it; enforced by `src/__tests__/ciWorkflows.structural.test.ts`; PR #54 dry-run ran the pinned version. Moving off `FIREBASE_TOKEN` is tracked in C11a*
- [ ] C11a **No CI credential can deploy except your personal token (found 2026-09-20).** `(You)` → [evidence](LAUNCH-EVIDENCE.md#c11a)
- [x] C12 Deploy runs on **every** push to `main`, including docs-only merges — add path filters or a manual approval gate before M1 — *2026-09-20: `(You)` → [evidence](LAUNCH-EVIDENCE.md#c12)
- [x] C13 Add a CI step that dry-runs `firebase deploy --dry-run` on PRs so config breaks are caught before merge — *2026-09-20: → [evidence](LAUNCH-EVIDENCE.md#c13)

## D. Legal, compliance and support `M1`

- [x] D1 **Scope changed by owner decision 2026-09-22: no dedicated `support@`/`privacy@` mailboxes at `actionstation.in`.** → [evidence](LAUNCH-EVIDENCE.md#d1)
- [ ] D2 Terms / Privacy reviewed by a human (entity name, address, grievance contact, India DPDP obligations; **also review the Sprint 2 additions**: Terms §5 refund clause (7-day full refund, one-time annual plan) and §7 payment-record retention on deletion, and whether the Privacy Policy must mention the retained `paymentRecords`) `(You)`
- [x] D3 Cookie banner: reject → PostHog never captures, verified in prod (plan scenario 6) → [evidence](LAUNCH-EVIDENCE.md#d3)
- [ ] D4 GDPR export and account deletion verified end-to-end in prod. `(You: a throwaway account that can sign in)` → [evidence](LAUNCH-EVIDENCE.md#d4)
- [x] D5 `docs/compliance/PCI-SAQ-A.md` reflects Razorpay-only checkout — *Rewritten 2026-09-25 from the Stripe version (Razorpay Checkout modal, server-created order, signature-verified webhook, Razorpay secrets and IDs). Attestation is still unsigned: the owner signs it after review `(You)`*

## E. Pre-launch scenarios — verify on production `M1`

From the commercial-readiness plan; all must pass before M1.

- [ ] E1 Pro user after Razorpay payment is **not** limited to 60 AI/day. — *Code audit done; misleading '60' limit copy fixed in #97. Not ticked: needs a live Pro account above 60 generations `(You)`* → [evidence](LAUNCH-EVIDENCE.md#e1)
- [x] E2 App Check enforced → AI generation works end-to-end — *Verified live 2026-09-20 (Sprint 3): → [evidence](LAUNCH-EVIDENCE.md#e2)
- [x] E3 App Check enforced → link preview works (no direct-fetch fallback in prod) → [evidence](LAUNCH-EVIDENCE.md#e3)
- [x] E4 Workspace with 1,200 nodes → save does not delete unseen nodes. → [evidence](LAUNCH-EVIDENCE.md#e4)
- [x] E5 Follower tab cannot lose data without a warning — *verified live 2026-09-20: a second tab opened while the owner's tab was leader showed 'This workspace is open in another tab. Edits from this tab will not be saved.' with a 'Take over editing' button; followers do not write (`MultiTabBanner.test.tsx`, `tabLeader*.test.ts`). The take-over button itself does not work, see E5a*
- [x] E6 Turnstile with site key set → login completes — *Verified 2026-09-20 (Sprint 3) from production logs: site key is in the live bundle and `verifyturnstile` returned **200 ×5** on 2026-09-20 (`res.status(200).json({ success: true })` only on a passed challenge; a failure is 403, none logged) from the Sprint 2b sign-ins that then reached the app*
- [x] E7 Rules and functions deploy from CI on merge to `main` (pipeline, not manual) → [evidence](LAUNCH-EVIDENCE.md#e7)
- [ ] E5a **'Take over editing' does nothing while the other tab is alive (found 2026-09-20, Sprint 4).** `(Claude; needs your call on behaviour)` → [evidence](LAUNCH-EVIDENCE.md#e5a)
- [ ] E8 **Over-limit (legacy) accounts: safe but poorly explained (found 2026-09-20, Sprint 4).** `(You: decide; Claude: build)` → [evidence](LAUNCH-EVIDENCE.md#e8)
- [x] E9 **Deleting an image Knowledge Base entry leaves the file in Storage, and the usage meter under-counts (found 2026-09-20, Sprint 4).** → [evidence](LAUNCH-EVIDENCE.md#e9)

## F. Resilience (plan Phase 7) `M1`

- [ ] F1 500+ node workspace: performance, spatial chunking, progressive loading
- [ ] F2 Three tabs editing: no data loss — *Second-tab follower and takeover covered by `resilience.spec.ts` (local run 2026-09-25)* Suite is green in CI, but only two tabs are exercised, so this stays open until three tabs are tested.
- [ ] F3 Offline → online: queued saves flush; slow 3G has no timeout crashes — *Offline card saved on reconnect covered by `resilience.spec.ts` (local run 2026-09-25); slow-3G not exercised* Suite is green in CI; slow 3G is not exercised, so this stays open.
- [ ] F4 Browsers: Chrome, Firefox, Safari, Edge (latest 2); Chrome Android, Safari iOS; PWA install on both
- [ ] F5 Touch on canvas: pinch zoom, drag nodes
- [ ] F6 Accessibility: Lighthouse a11y 90+ (target 95+), keyboard-only flows, VoiceOver and NVDA passes

---

## G. Gold Standard for BASB `M2`

BASB = **C**apture → **O**rganize → **D**istill → **E**xpress. A feature belongs here only if it reduces friction between thought and capture, or between capture and insight. Targets marked *(proposed)* are starting points to confirm with you.

**Capture**
- [ ] G1 Capture-to-node latency and keystroke count measured; *(proposed)* under 2 s, fully keyboard-driven
- [ ] G2 Mobile capture path decided (evaluate `docs/mobile/KMP-MOBILE-PLAN.md`) `(You)` decision
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
- [x] G12 Playwright E2E suite for golden paths: sign-in, capture, save/reload, AI, upgrade, export, delete — *Built 2026-09-25 : 18 Playwright tests on the Firebase emulators cover sign-in, capture, save/reload, multi-tab, offline, AI (stubbed), free-tier limits and Pro, export, delete-account; new CI job `e2e`. Ticked 2026-09-25: PR #100 merged as `7db36c6`, with the `e2e` job green on the PR and `ActionStation CI` green on `main`, deploy run succeeded. Not covered: upgrade payment (stubbed), server export, other browsers. Runbook: `docs/runbooks/E2E-TESTING.md`*
- [ ] G13 Performance budgets enforced in CI (Lighthouse perf, bundle size, boot time)
- [ ] G14 In-app feedback + "report a bug" + changelog — plan 8.3
- [ ] G15 Closed beta with 5–10 real BASB practitioners; findings triaged into this file
- [x] G16 Brand icon set (Λ + station dot) replaces the placeholder blue squares and the checkmark logo: `(Claude)` → [evidence](LAUNCH-EVIDENCE.md#g16)
- [ ] G17 After deploy: confirm on production that the tab favicon, iOS "Add to Home Screen" icon, Chrome install prompt icon (maskable, not clipped) and a Slack/LinkedIn/X link preview all show the new mark (browsers cache favicons; use a fresh profile and each platform's card-cache refresh) `(Claude)`
- [ ] G18 Upload the logo where only a console can: Google OAuth consent screen (square PNG, 120×120 px, ≤1 MB; export from `public/pwa-512x512.png`; adding it can trigger Google's branding re-review, so do it with A10b), Razorpay checkout/business logo, and any Workspace/social avatars `(You)` — *Re-checked 2026-09-25 (read-only, Claude in Chrome): **Google consent screen already shows the blue tick logo** (an earlier same-day note said it was empty; that was the image still loading). **Razorpay is the only gap:** Account & Settings → Checkout Styling → Brand Name and Logo has no logo (checkout preview shows a letter placeholder and the account name). The dialog needs the OS file picker, so it cannot be automated: choose *Logo & Text*, upload `public/pwa-192x192.png` (square, under 1 MB), set the brand name (also closes B21). The Razorpay brand applies to the whole shared account (see B12) `(You)`*

## H. Growth (post-launch) `M2`

- [ ] H1 Referral / invite loop — plan 8.4
- [ ] H2 Stripe / global billing and tax — only if going beyond India
- [ ] H3 Revisit Cloudflare Pages / R2 and WAF choices against real cost data

## I. Housekeeping

- [x] I1 Decide on untracked files — *Resolved 2026-09-25: the stale tooling files (`.cursor/`, `.agent/workflows/`, `mydocs/`, `verify/`, old Firebase audit reports, `CLAUDE_SKILLS.md`, root `MEMORY.md`) were deliberately deleted by the owner in commit `a631890`; `.kilo/` never existed; the KMP mobile plan was kept as `docs/mobile/KMP-MOBILE-PLAN.md`. Nothing untracked remains*
- [ ] I2 Delete or archive `~/Downloads/actionstation-website` (unrelated AI-BORNE fragment) `(You)`
- [x] I3 Retire stale plan docs or mark them "superseded by this checklist" — *Done: every `plans/*.md` carries a Historical/superseded status line pointing here*
- [x] I4 Update `PRODUCTION-LAUNCH-PLAN.md` status table to point here — *2026-09-25: the stale March-2026 status table in `PRODUCTION-LAUNCH-PLAN.md` was replaced by a pointer to this file*
- [ ] I5 `CLAUDE.md` "Free tier limits" table says Pro is Unlimited; `tierLimits.ts` (SSOT) is 50 workspaces / 500 nodes / 500 AI per day / 5,120 MB. Update the table (it is your file, so not changed here) `(You)`
- [ ] I6 **PWA icons are a placeholder (found 2026-09-20, Sprint 3).** `public/pwa-192x192.png` and `pwa-512x512.png` are a plain solid-blue square, so an installed PWA shows no logo. Replace them with the ActionStation mark (blue circle + white check, as in `favicon.svg`; a 240 px render exists from the A10b logo). Tied to F4 (PWA install) `(Claude, needs your OK on the design)`

---

## Change log

Full history, newest first: [`LAUNCH-CHANGELOG.md`](LAUNCH-CHANGELOG.md). Long per-item evidence: [`LAUNCH-EVIDENCE.md`](LAUNCH-EVIDENCE.md). At sprint end add a dated row to the changelog and keep only a summary here.

| Date | Change |
|------|--------|
