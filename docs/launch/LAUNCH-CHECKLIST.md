# ActionStation — Launch Checklist (Single Source of Truth)

> **Goal: the Gold Standard web app for Building a Second Brain (BASB).**
> Every sprint starts by reading this file and ends by ticking boxes in it, with evidence.
> Last verified against live systems: **2026-09-20**

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

## Status snapshot (2026-09-20)

| Area | State |
|------|-------|
| Code (`main`) | Sprints 1–4, A, C merged (PR #51, #52). `feature/sprint1` (PR #54, unmerged): 626 test files / 17,129 tests pass |
| Production site | `www.actionstation.in` **live on the new build** (deployed 2026-09-20 06:47 IST). Hosting, 24 functions, rules and indexes deployed by CI |
| Domain / DNS | Connected in Firebase Hosting; apex `actionstation.in` → 301 → `www` |
| Payments | Razorpay in **TEST mode** (`rzp_test_`). Stripe secret is a **placeholder** (not launching) |
| WAF (Cloud Armor) | **Not deployed** (Compute API disabled). Deferred by decision |
| Monitoring alerts | 8 enabled policies + 7 log metrics on channel `Eden Alerts` (email). Fixed for gen2 on 2026-09-20 (were dead). Email delivery unproven until a real alert fires |
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
- [ ] A7 Prod smoke test on `www.actionstation.in`: Google login, Turnstile, save, AI, link preview, upload, calendar connect, export, delete account
- [ ] A8 **Sign in once before 2026-10-13** — Google deletes the unused OAuth client (`190777323740-ccsb…`) after that date (satisfied by A7)
- [x] A9 No debug flags in the prod bundle: no dev-bypass flag, no embedded App Check debug token, no direct Gemini endpoint, no `rzp_test_`/`sk_` strings — *scanned live JS, 2026-09-20*

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
- [x] C3 Monitoring: `scripts/setup-monitoring-alerts.sh` run; `auth_failure_spike` and `bot_detected_spike` metrics + policies exist — *2026-09-20: 6 log metrics and 7 enabled policies verified via `gcloud … list`, all on channel `Eden Alerts` (mail.sunilpawar@gmail.com). Chat channel (Slack) not created: no webhook supplied, script supports `SLACK_WEBHOOK_URL`. Email delivery not yet proven by a real alert — check inbox/spam for the first notification*
- [x] C3a **Dead monitoring (found 2026-09-20):** all 24 functions are gen2 (`resource.type="cloud_run_revision"`), but the two live alerts and the `geminiProxy_429` metric filter on `cloud_function`, so they can never fire. `setup-monitoring-alerts.sh` also uses `resource.type="global"` for the auth/bot alerts (never matches a log-based metric on a Cloud Run log), omits `notificationChannels` on those two policies, is not idempotent (re-run duplicates policies) and hides errors with `2>/dev/null`. Fix the script, then verify each alert against a real matching series — *fixed 2026-09-20: gen2 filters, `ALIGN_DELTA` per-minute counts (old `ALIGN_RATE` with threshold 50 meant 50/sec), upsert by displayName, channel on every policy, errors visible, `mktemp`; the live 2 policies were updated in place. Filter shape confirmed against 31 real `webhook_processing_error` entries*
- [x] C3b gcloud default project on this machine is `payslip-app-475e1`; scripts must always pass `--project` explicitly (they do; keep it that way) — *verified in script, 2026-09-20*
- [ ] C3c Razorpay test payments 2026-08-28/29 produced 31 `webhook_processing_error` events (`payment.captured: missing userId in notes`). Belongs to B2 — the order must carry `userId` in `notes`
- [ ] C4 Backups: confirm bucket is immutable (retention lock) per `scripts/setup-immutable-backups.sh`; verify a scheduled backup ran; **restore drill** once — *2026-09-20: new bucket `…-firestore-backups-immutable` (us-central1, uniform access, versioning, 30-day retention, **unlocked**); manual run wrote 338 docs / 925 KB; restore drill passed (see C4f). Left open until the retention lock (C4g) is applied. Legacy `…-firestore-backups` bucket is empty (see C4h)*
- [x] C4a **Backups have never worked (found 2026-09-20):** `firestoreBackup` fires daily 02:00 UTC and fails `403 PERMISSION_DENIED` (Cloud Scheduler status 13). Cause: the gen2 function runs as the default compute SA (`190777323740-compute@…`, only `roles/editor`); `datastore.importExportAdmin` was granted to the appspot SA instead — *fixed 2026-09-20: `roles/datastore.importExportAdmin` granted to the compute SA by `setup-immutable-backups.sh`; scheduler job re-run → export operation SUCCESSFUL*
- [x] C4b Deployed code targets `gs://actionstation-244f0-firestore-backups-immutable`, which **does not exist**. The legacy bucket is empty (0 objects), has no retention policy, no versioning, uniform access off, and a 30-day delete lifecycle — *fixed 2026-09-20: bucket created and verified with `gcloud storage buckets describe`; objects present under `2026-09-20/`*
- [x] C4c `scripts/setup-immutable-backups.sh` is broken for macOS (`${CONFIRM,,}` needs bash 4), grants the wrong SA, swallows errors, uses `/tmp` and deprecated `gsutil`; rewrite it so locking is a separate, explicit step — *rewritten 2026-09-20: idempotent, `gcloud storage`, `mktemp`, correct SAs, no lock step (lock command printed only). Stale header comment in `firestoreBackup.ts` fixed*
- [x] C4d No alert exists for a failed backup — it failed silently at least once (the >50/min 5xx alert cannot catch a once-a-day job). Add a `firestore_backup_failed` log metric + alert — *2026-09-20: `firestore_backup_failed` metric + policy `HIGH: Firestore Backup Failed` created via `setup-monitoring-alerts.sh`*
- [ ] C4e Firestore PITR is **disabled** (version retention 1 h) and there is no managed backup schedule. Decide: enable PITR (7-day window, extra storage cost) and/or a managed daily schedule as a second layer `(You)` decision
- [ ] C4g **Lock the retention policy** on `…-firestore-backups-immutable` — IRREVERSIBLE; recommended only after 2–3 scheduled nightly backups have succeeded. Command in `docs/runbooks/FIRESTORE-RESTORE.md` `(You)` decision
- [ ] C4h Delete the empty legacy bucket `actionstation-244f0-firestore-backups` (or leave; it costs nothing) `(You)`
- [x] C4f Restore drill runbook `docs/runbooks/FIRESTORE-RESTORE.md` — restore into a scratch database, never into `(default)` — *2026-09-20: runbook added; drill restored into scratch DB `restore-drill`, counts matched `(default)` (workspaces 21, nodes 185, edges 84, knowledgeBank 33, usage 1); scratch DB deleted*
- [x] C5 Uptime monitor on `…/health` and on `https://www.actionstation.in` with email alerting (`docs/UPTIME-MONITORING.md`) — *2026-09-20: 2 Cloud Monitoring uptime checks (5 min, 10 s timeout) + 2 CRITICAL alert policies on `Eden Alerts`; `scripts/setup-uptime-checks.sh` idempotent (re-run creates no duplicates). Verified via Monitoring API: `check_passed=true` and HTTP 200 from all 6 regions for the site; `/health` passing from 5 regions incl. the `"status":"ok"` matcher. Email delivery of an actual alert is unproven*
- [ ] C6 WAF decision recorded: Cloud Armor vs Cloudflare in front vs none for M1 (see Locked decisions)
- [ ] C7 Dependency audit: moderates remain (vitest 5 for dev tooling; `firebase-admin` 14 via `uuid`). Schedule upgrades; CLAUDE.md says audit 0
- [ ] C8 CSP `img-src` contains `data:` but CLAUDE.md forbids it — fix or record the exception
- [ ] C9 Secret hygiene per `docs/security/KEY-LIFECYCLE.md`; rotation dates recorded
- [ ] C10 GitHub Actions Node 20 deprecation warnings — bump action runtimes
- [x] C11 `firebase-tools` pinned (broke `storage:rules` in v15) — *2026-09-20: `FIREBASE_TOOLS_VERSION: '15.30.2'` in `deploy.yml` and `ci.yml`, every `npx` invocation uses it; enforced by `src/__tests__/ciWorkflows.structural.test.ts`; PR #54 dry-run ran the pinned version. Moving off `FIREBASE_TOKEN` is tracked in C11a*
- [ ] C11a **No CI credential can deploy except your personal token (found 2026-09-20).** `FIREBASE_SERVICE_ACCOUNT` is `firebase-adminsdk-fbsvc` (roles: sdkAdminServiceAgent, appcheck.admin, auth.admin, tokenCreator, storage.admin; one long-lived key from 2026-02-28). Its role lacks `cloudfunctions.functions.list`, `datastore.indexes.*`, `firebaserules.releases.create`, `iam.serviceAccounts.actAs`, `cloudscheduler.jobs.create`, so it cannot deploy rules/indexes/functions or run a functions dry-run. CI therefore deploys with `FIREBASE_CI_TOKEN` = a personal refresh token (deprecated, full account access, and `preview.yml` already hands the adminsdk key to PR runs). Needs a dedicated least-privilege deployer identity, ideally Workload Identity Federation (no stored key) `(You)` decision — *Progress 2026-09-20: keyless Workload Identity Federation is live and proven (pool `github-actions`, provider locked to `ai-borne/actionstation`, read-only SA `ci-dryrun`, custom role `ciDryRunRulesTest` = `firebaserules.rulesets.test` only, since every predefined role with that permission can also overwrite production rules; scoped actAs on the two runtime SAs; repo vars `GCP_WIF_PROVIDER`, `GCP_DRYRUN_SA`; `scripts/setup-github-wif.sh`). **Remaining:** create a separate deploy SA whose workloadIdentityUser binding is limited to `refs/heads/main` (provider already maps `attribute.ref`), grant deploy roles (rules admin, index admin, cloudfunctions/run/scheduler/eventarc admin, secretmanager, artifactregistry, hosting), switch `deploy.yml` steps to it, remove `FIREBASE_TOKEN`/`FIREBASE_CI_TOKEN`, then revoke that token and retire the `firebase-adminsdk` key from `preview.yml` (use hosting-only SA or WIF)*
- [x] C12 Deploy runs on **every** push to `main`, including docs-only merges — add path filters or a manual approval gate before M1 — *2026-09-20: `deploy.yml` `paths-ignore` (`docs/**`, `plans/**`, `**/*.md`, `.cursor/**`, `.kilo/**`) + `workflow_dispatch` for manual deploys; structural test also asserts code paths are never ignored. Runtime proof pending the next docs-only merge to `main`. A required-reviewer approval gate is still an option before M1 `(You)`*
- [x] C13 Add a CI step that dry-runs `firebase deploy --dry-run` on PRs so config breaks are caught before merge — *2026-09-20: job `Firebase Deploy Dry-Run` in `ci.yml` (same-repo PRs only), keyless WIF, validated rules + indexes + functions build on PR #54 (run 35485757086, attempt 4 green). Attempts 1–3 failed on missing actAs, then `firebaserules :test` permission, then IAM propagation lag, which shows the check exercises real permissions*

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
| 2026-09-20 | **Sprint 1 (PR #54, not merged):** C3 monitoring fixed (alerts were dead on gen2), C4 backups repaired (had 403'd since setup; restore drill passed), C5 uptime checks live, C11 pinned, C12 paths-ignore, C13 WIF dry-run. New blockers found and logged: C3a–c, C4a–h, C11a. Open for you: C4e PITR decision, C4g retention lock (irreversible), C4h legacy bucket, C11a deploy identity |
| 2026-09-20 | PR #51 and #52 merged; production deployed and verified (A4, A5, A6, A9). Deploy exposed CI tooling gaps (C11–C13). Fixed flaky `withRetry` backoff test. Lesson: run the **full** `npm run check` before pushing, not just structural tests |
| 2026-09-19 | Created. Domain connected (`www.actionstation.in`), SEO aligned, CI fixed, PR #51 green. Live-state audit: Razorpay test keys, no WAF, 2 alert policies, no uptime monitor, no mailboxes |
