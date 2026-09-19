# MEMORY.md — Architectural Decision Log

> A living record of every significant architectural decision made during the project.
> Read this before touching any major subsystem. Update it when you make a new decision.

---

## Architecture Sprint — Hardening (Mar 2026)

### Context
A full production architecture audit was run against the BASB codebase, followed by a multi-phase hardening sprint and a post-sprint quality review. All decisions below were made and implemented during this period.

---

## Decision 1 — Structured Logger

**Problem:** ~40 raw `console.*` calls scattered across the codebase. Errors not reported to Sentry. No way to suppress logs in production.

**Decision:** Centralise all logging behind `src/shared/services/logger.ts`.

```typescript
logger.error(msg, error?, context?) // → Sentry captureException + console.error
logger.warn(msg, ...args)           // → console.warn only
logger.info(msg, ...args)           // → console.info, gated in production
```

**Enforcement:** `noConsoleLog.structural.test.ts` fails the build if any raw `console.*` call is found outside the logger itself.

---

## Decision 2 — Base64 Stripping Before Firestore Writes

**Problem:** TipTap `allowBase64: true` means base64 image data could leak into Firestore node documents, hitting the 1 MB document limit and causing silent data corruption.

**Decision:** `stripBase64Images()` in `src/shared/utils/contentSanitizer.ts` strips all `data:image/*;base64,...` payloads from node data before any Firestore write. Replaced with `[image-uploading]` placeholder during upload.

**Called in:** `saveNodes()`, `appendNode()` in `workspaceService.ts`.

**Enforcement:** `noBase64InFirestore.structural.test.ts`.

---

## Decision 3 — Firestore Query Caps

**Problem:** `getDocs(collection(db, 'nodes'))` with no `limit()` would fetch thousands of documents, causing cost explosions and UI freezes.

**Decision:** All `getDocs` calls must use `limit()`. Constants live in `src/config/firestoreQueryConfig.ts`:

```typescript
export const FIRESTORE_QUERY_CAP = 1000;   // nodes/edges per workspace
export const WORKSPACE_LIST_CAP = 100;     // workspaces per user
export const FIRESTORE_BATCH_DELETE_CAP = 500; // batch delete chunk size
```

**Enforcement:** `firestoreQueryCap.structural.test.ts`.

---

## Decision 4 — Node/Edge Ownership Fields

**Problem:** Node documents in Firestore lacked `userId` and `workspaceId` fields, making server-side rules rely solely on path matching.

**Decision:** Every node and edge write now includes `userId` and `workspaceId`. Firestore rules validate both the path-level auth AND `resource.data.userId == request.auth.uid` (defence in depth).

**Enforcement:** `firestoreRules.structural.test.ts`.

---

## Decision 5 — chunkedBatchWrite (Bug Fix)

**Problem:** `saveNodes` used a single `writeBatch` for the large-workspace path (>500 ops). Firestore rejects batches over 500 operations — this would silently crash saves for large workspaces.

**Decision:** `chunkedBatchWrite()` in `firebaseUtils.ts` splits any array of ops into 500-op chunks and commits each sequentially. `saveNodes` and `saveEdges` use this for the >500 path.

**runTransaction vs batch:**
- ≤500 ops → `runTransaction()` (read-then-write consistency)
- >500 ops → `chunkedBatchWrite()` (no read consistency, but safe for single-user workspaces)

---

## Decision 6 — Schema Versioning + Migration Runner

**Problem:** Firestore schema evolution relied on optional fields with no tracking. No way to know if a document was created before or after a schema change.

**Decision:** Every workspace and node document carries `schemaVersion: number`. `src/migrations/migrationRunner.ts` runs pending migrations on load — pure, idempotent, backward-compatible.

**Current version:** `CURRENT_SCHEMA_VERSION = 2`

**Rule:** New migrations must be added to `migrations: Migration[]` and `CURRENT_SCHEMA_VERSION` must be bumped. Migrations must not make network calls (pure functions only).

---

## Decision 7 — Web Worker for TF-IDF / Clustering

**Problem:** `computeClusters()` and `rankEntries()` ran on the main thread. On workspaces with 500+ nodes this caused visible UI lag and could trigger "Maximum update depth exceeded" if called during a render cycle.

**Decision:** Move heavy computation to `src/workers/knowledgeWorker.ts`. Client API is `knowledgeWorkerClient.ts` — Promise-based, with automatic main-thread fallback if Web Workers are unavailable.

**Crash guard:** After 3 worker crashes, `crashCount >= MAX_WORKER_CRASHES` permanently disables the worker and falls back to main-thread. Prevents spin-loop on persistent crashes.

---

## Decision 8 — Firestore Bundle Optimisation

**Problem:** Every page load fetched the full workspace list from Firestore — a cold-start latency hit proportional to the number of workspaces.

**Decision:**
1. `workspaceBundle` Cloud Function generates a Firestore Bundle containing the user's workspace list.
2. `bundleLoader.ts` calls the function, caches the result in `sessionStorage` (5-min TTL).
3. `loadUserWorkspaces` tries `loadWorkspaceBundle()` first; falls back to direct Firestore query if bundle is unavailable or stale.
4. Bundle cache is invalidated on workspace create/delete.

**Bundle cap** (`WORKSPACE_LIST_CAP = 100`) is shared via `functions/src/constants.ts` to prevent silent client/server divergence.

---

## Decision 9 — Storage Orphan Cleanup

**Problem:** When nodes were deleted, associated Storage files (images, attachments, thumbnails) were left as orphans indefinitely.

**Two-layer solution:**

1. **Client-side:** `cleanupDeletedNodeStorage()` in `nodeStorageCleanup.ts` extracts all Storage URLs from deleted node data and calls `deleteObject` via the client SDK. Called from `saveNodes` (diff-based) and `deleteWorkspace` (full sweep).

2. **Server-side:** `onNodeDeleted` Cloud Function triggered by `onDocumentDeleted` — catches any deletions that bypass the client (e.g. admin tools, other clients).

Both layers are idempotent — `deleteObject` on a missing file is a no-op.

---

## Decision 10 — Storage Lifecycle Policies

**Problem:** Temporary uploads in `tmp/` had no automatic cleanup. Storage costs would grow unbounded.

**Decision:** `storage-lifecycle.json` defines GCS lifecycle rules:
- `.tmp` files under `users/` → delete after 7 days
- `tmp/` prefix → delete after 30 days

`deploy.yml` runs `gsutil lifecycle set storage-lifecycle.json gs://$BUCKET` after every production deploy — infrastructure-as-code, not a manual ops step.

`scheduledStorageCleanup` Cloud Function runs daily as a belt-and-suspenders sweep for any files lifecycle rules miss.

---

## Decision 11 — Search Debounce

**Problem:** `SearchBar` fired search computation on every keystroke — expensive on large workspaces.

**Decision:** `useDebouncedCallback(fn, 250)` in `src/shared/hooks/useDebounce.ts` wraps all search triggers. Uses a `callbackRef` pattern to avoid stale closure issues.

---

## Decision 12 — useCallback Stability via useRef

**Problem:** `useWorkspaceSwitcher.switchWorkspace` and `useWorkspaceOperations.handleNewWorkspace` included reactive Zustand state (`user`, `currentWorkspaceId`) in their `useCallback` deps. This caused the callback reference to change on every workspace switch, re-triggering all consumers and feeding cascading re-renders near the canvas.

**Decision:** Read live values via `useRef` mirrors, keep `useCallback` deps as `[]`:

```typescript
const userRef = useRef(user);
const currentIdRef = useRef(currentWorkspaceId);
userRef.current = user;     // always fresh
currentIdRef.current = currentWorkspaceId;

const handleSwitch = useCallback(async (id) => {
    const curId = currentIdRef.current; // reads current value without being a dep
    ...
}, []); // stable reference — never recreated
```

**Applies to:** `useWorkspaceSwitcher`, `useWorkspaceOperations`.

---

## Decision 13 — Primitive Selectors in useEffect Dependencies

**Problem:** `useWorkspaceLoading` and `useWorkspaceLoader` both had `user` (object reference) in `useEffect` deps. If `useAuthStore` reconstructed the user object on any auth-related re-render, the entire workspace load pipeline fired again — duplicate Firestore reads and potential double-setState flicker.

**Decision:** Select the primitive you actually need:

```typescript
// In useWorkspaceLoading
const userId = useAuthStore((s) => s.user?.id); // string | undefined
useEffect(() => {
    if (!userId) return;
    const uid: string = userId;
    ...
}, [userId]); // only re-runs when the ID itself changes

// In useWorkspaceLoader
const userId = useAuthStore((s) => s.user?.id);
useEffect(() => { ... }, [userId, workspaceId]);
```

---

## Decision 14 — backfillNodeCount DRY Helper

**Problem:** The `nodeCount` backfill logic (counting nodes via `getCountFromServer` + fire-and-forget `setDoc`) was duplicated verbatim between `loadWorkspace` and `loadUserWorkspaces`.

**Decision:** Extract `backfillNodeCount(userId, workspaceId, docRef)` and `buildWorkspace(data, userId, nodeCount)` helpers inside `workspaceService.ts`. Both functions now call these. `workspaceService.ts` reduced from 304 lines to 281.

---

## Decision 15 — Migration v2 is a No-Op

`migration_002_ensure_userId_field` was implemented as `node.userId ?? undefined` — which is a mathematical no-op. The intent (backfilling `userId` on legacy nodes) cannot be achieved in a pure migration function because the runner has no access to the calling user's ID.

**Correct approach:** `userId` is written by `workspaceService.saveNodes` on every save. The next time a legacy node is saved, it gets `userId`. The migration version slot (v2) is preserved as a no-op to avoid resequencing subsequent migrations.

---

---

## Production Hardening Sprint — Mar 17 2026

### Context
A full production readiness audit was run (20 sections). All critical findings were fixed in a single sprint. All 5050 tests green. 0 npm vulnerabilities.

---

## Decision 16 — CSP via HTTP Header, Not Meta Tag

**Problem:** CSP was delivered via `<meta http-equiv="Content-Security-Policy">`. Meta-tag CSP cannot enforce `frame-ancestors` (ignored by browsers).

**Decision:** Move CSP to `firebase.json` hosting headers block. Remove meta tag from `index.html` entirely.

**Enforcement:** `cspCompleteness.structural.test.ts` reads from `firebase.json` headers — not `index.html`. If the meta tag is re-added, the test must not be updated to read from it.

---

## Decision 17 — Gemini API Key Never Reaches Browser in Production

**Problem:** `VITE_GEMINI_API_KEY` was potentially exposable via the Vite build.

**Decision:** `VITE_GEMINI_API_KEY` is intentionally absent from `deploy.yml`. In production all Gemini calls route: Frontend → `VITE_CLOUD_FUNCTIONS_URL/geminiProxy` → Cloud Function → Gemini (key held in Google Secret Manager). Direct API key is dev-only fallback.

**Enforcement:** `geminiKeyIsolation.structural.test.ts` — only `geminiClient.ts` may reference the env var. CI deploy workflow has no `VITE_GEMINI_API_KEY` entry.

---

## Decision 18 — envValidation REQUIRED_VARS has a Test Mirror

**Problem:** `envValidation.ts` REQUIRED_VARS was updated (added `VITE_GOOGLE_CLIENT_ID`) but the structural test maintained a hardcoded copy — causing CI failure.

**Rule:** Whenever a var is added to or removed from `REQUIRED_VARS` in `src/config/envValidation.ts`, the array in `src/__tests__/envValidation.structural.test.ts` **must be updated in the same commit**.

Current list (8 vars): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_CLOUD_FUNCTIONS_URL`, `VITE_GOOGLE_CLIENT_ID`.

---

## Decision 19 — Cyrillic Homoglyph Patterns Require NFKD Normalization [RESOLVED: Phase 6.1]

**Problem:** Character-class regex patterns like `/[\u0420P][\u0420R]/gi` (mixing Cyrillic + ASCII in same class) caused false positives — ASCII words like `prompt` were filtered by the PROMPT detection pattern.

**Decision:** Removed all 3 Cyrillic character-class patterns from `INJECTION_PATTERNS`. Deferred to dedicated security sprint with correct approach.

**Resolution (Phase 6.1):** Implemented a 3-step Unicode normalization pipeline in `functions/src/utils/textNormalizer.ts`:
1. NFKD decomposition — decomposes ligatures (ﬁ→fi), fullwidth chars (Ａ→A)
2. Combining char strip — removes diacritical marks via `\p{Mn}` regex
3. Confusables map — maps Cyrillic/Greek homoglyphs to ASCII equivalents

**Key invariant:** Length checks run on ORIGINAL text; patterns run on normalized text. This prevents confusable-padding bypass of length limits.

**Files:** `functions/src/utils/textNormalizer.ts` (new), `functions/src/utils/promptFilter.ts` (modified), `functions/src/utils/__tests__/textNormalizer.test.ts` (49 tests)

**Note:** NFKD alone is insufficient for Cyrillic/Greek (they are separate Unicode codepoints, not decomposable). The confusables map is required in addition.

---

## Decision 19b — Rate Limiter is Firestore-Backed in Production (Not Per-Instance)

**Finding (Phase 6.5):** `ipRateLimiter.ts` and `rateLimiterFactory.ts` both use `isDeployedFunction()` = `!!process.env.K_SERVICE && FUNCTIONS_EMULATOR !== 'true'`. In Cloud Run (production), `K_SERVICE` is automatically set → Firestore-backed. In-memory path only in emulator/tests. No distributed rate limit vulnerability exists.

**File:** `functions/src/utils/ipRateLimiter.ts` (production safety comment added)

---

## Decision 20 — React.lazy Requires async act() in Tests

**Problem:** Converting `KnowledgeBankPanel` to `React.lazy` broke all 14 `Layout.integration.test.tsx` tests — Suspense resolution fires as async microtask after `render()` returns.

**Decision:** All Layout integration tests use an `async renderLayout()` helper:
```tsx
async function renderLayout() {
    let result!: ReturnType<typeof render>;
    await act(async () => { result = render(<Layout><div /></Layout>); });
    return result;
}
```
**Rule:** Any test that renders a component tree containing a `React.lazy` boundary must wrap `render()` in `await act(async () => {})`.

---

## Decision 21 — /health Endpoint for Uptime Monitoring

**Decision:** `functions/src/health.ts` exports a `health` Cloud Function (no auth, CORS-allowed) returning `{status, version, timestamp}`. Used for uptime monitoring services (BetterUptime, Checkly etc.).

**URL:** `https://us-central1-actionstation-244f0.cloudfunctions.net/health`

---

---

## Advanced Security Hardening Sprint — Mar 17 2026

### Context
Following the Production Hardening Sprint, a second targeted sprint addressed advanced security gaps: WAF-layer bot detection, distributed abuse protection, AI prompt safety, file upload security, and threat monitoring.

---

## Decision 22 — Six-Layer Security Stack for Cloud Functions

**Problem:** Per-user rate limiting alone cannot stop distributed multi-account attacks (100 IPs × 10k req/hr). No visibility into security events. AI endpoints lacked prompt injection protection. No file upload validation.

**Decision:** Six new utilities implement defence-in-depth at the Cloud Function edge, applied in strict order:

```
Bot Detection → IP Rate Limit → Auth → User Rate Limit
→ Body Size → Prompt Filter → Token Cap → Output Scan
```

**Files created:**
- `functions/src/utils/securityLogger.ts` — structured JSON events to Cloud Logging. Severity: WARNING (auth fail, rate limit), ERROR (bot, injection, IP block), CRITICAL (spike alerts). All entries carry `labels.eden_security: "true"` for Cloud Monitoring log-based alert policy.
- `functions/src/utils/botDetector.ts` — 24 scanner/automation UA patterns (sqlmap, nikto, masscan, nuclei, Burp, ZAP, curl, python-requests, Go-http-client…) + 6 headless browser patterns (HeadlessChrome, Playwright, Puppeteer, Selenium…) + heuristic header checks. Rejects before auth → zero Firestore cost for bots.
- `functions/src/utils/ipRateLimiter.ts` — per-IP sliding window (30 req/min Gemini). Firestore-backed in production (survives cold starts, consistent across instances). Same pattern as `firestoreRateLimiter.ts`. Stops the "100 IPs × 10k req/hr" scenario that bypasses per-user limits.
- `functions/src/utils/promptFilter.ts` — **Input layer:** 14 injection regexes (DAN mode, jailbreak, `[SYSTEM]`, `<|im_start|>`, ignore-previous-instructions, forget-everything, act-as-evil…) + 5 exfiltration patterns (repeat system prompt, print API key, reveal credentials…) + 50k/100k char limits. **Output layer:** scans Gemini responses for GCP API keys (`AIza…`), Bearer tokens, private key headers before forwarding to client.
- `functions/src/utils/fileUploadValidator.ts` — magic-byte detection for 12 types (PNG/JPEG/GIF/WEBP/PDF/ZIP/GZ/RAR/7Z/ELF/PE/MZ), archive hard-block (zip bomb vector), polyglot detection (ZIP/EXE inside image claim), MIME mismatch blocking, 30 dangerous extension blocks (.exe/.sh/.php/.py…), per-type size limits (1 MB text, 10 MB image, 20 MB PDF).
- `functions/src/utils/threatMonitor.ts` — in-process spike counters with per-minute thresholds: 429 spike (50/min), 500 spike (20/min), auth failure (30/min), bot (10/min). Writes CRITICAL log on threshold → Cloud Monitoring alert fires.

**New constants in `securityConstants.ts`:**
- `IP_RATE_LIMIT = 120` — general per-IP ceiling
- `IP_RATE_LIMIT_GEMINI = 30` — Gemini-specific (inference is expensive)
- `UPLOAD_MAX_BODY_BYTES = 52_428_800` — 50 MB hard ceiling before per-type checks

**Tests:** 225 passing (all new files have full test coverage). TypeScript clean (`tsc` 0 errors).

---

## Decision 23 — Bot Rejection Before Auth

**Problem:** Bots reaching `verifyAuthToken()` trigger Firebase Admin SDK calls (and Firestore rate limit reads). Under scanner load, this wastes Cloud Function compute.

**Decision:** `detectBot(req)` runs as the first check in every HTTP handler, before any auth or Firestore call. Only `confidence: 'high'` and `confidence: 'medium'` detections are hard-blocked (403). `confidence: 'low'` is logged but allowed through (avoids false-positive blocking legitimate automation).

---

## Decision 24 — IP Rate Limiting is Separate from User Rate Limiting

**Problem:** User rate limits are keyed on Firebase UID. An attacker with 100 accounts, each under the per-user limit, bypasses user rate limiting entirely.

**Decision:** `ipRateLimiter.ts` is a second independent layer keyed on client IP (from `X-Forwarded-For`). Both layers must pass for a request to proceed. The IP limit is intentionally looser than the user limit (30 vs 60 for Gemini) to avoid blocking legitimate users behind NAT.

---

## Decision 25 — Prompt Output Scanning

**Problem:** A misconfigured system prompt or adversarial input could theoretically cause Gemini to echo back secrets (API keys, private keys) that were injected into the function environment.

**Decision:** `filterPromptOutput()` scans the serialised Gemini response JSON for GCP API key patterns (`AIza[0-9A-Za-z_-]{35}`), Bearer tokens, and `-----BEGIN PRIVATE KEY-----` fragments before the response is forwarded to the client. On match: 502 + RULE_DENIAL security log.

---

---

## WAF / CAPTCHA / Immutable Backups Sprint — Mar 17 2026

### Context
Following the Advanced Security Hardening Sprint, the three remaining external-service gaps (WAF, CAPTCHA, immutable backups) were fully implemented with scripts and Cloud Function code. All are ready to deploy.

---

## Decision 26 — Cloud Armor WAF via Serverless NEG + HTTPS Load Balancer

**Problem:** Cloud Armor policies cannot attach directly to Cloud Run / Firebase Functions URLs — they require a load-balancer backend service. The `*.cloudfunctions.net` endpoints were unprotected at the network edge.

**Decision:** `scripts/setup-cloud-armor.sh` automates the full stack:
1. Cloud Armor security policy with 8 OWASP CRS v3.3 rule sets (SQLi, XSS, LFI, RFI, RCE, method enforcement, scanner detection, protocol attack) + IP rate-limit rule (100 req/min, 5-min ban).
2. Serverless NEGs for every Cloud Run service (one NEG per function).
3. Backend services, each with the security policy attached.
4. HTTPS load balancer (URL map → path routing → backends) with Google-managed SSL cert.

**DNS step:** After running the script, the DNS A record for `www.actionstation.in` must be pointed to the LB IP printed by the script. WAF only protects traffic routed through this LB.

**Cost:** ~$5/month policy + $0.75/million requests + ~$18/month LB base.

---

## Decision 27 — Cloudflare Turnstile `verifyTurnstile` Cloud Function

**Problem:** Login and upload endpoints had no bot-challenge gate. Automated credential-stuffing and upload-spam attacks could proceed directly to Firebase Auth and Cloud Storage.

**Decision:** `functions/src/verifyTurnstile.ts` implements a `POST /verifyTurnstile` endpoint:
- IP rate-limited to `IP_RATE_LIMIT_CAPTCHA = 10 req/min` (pre-auth, so IP-only limiting)
- Calls Cloudflare's `POST /siteverify` with the one-time token + client IP
- On failure: 403 + `CAPTCHA_FAILED` security log event
- Secret `TURNSTILE_SECRET` held in Google Cloud Secret Manager (never in code)

**Client integration pattern:** Complete Turnstile widget → POST token to this endpoint → check 200 → proceed with Firebase Auth / upload.

---

## Decision 28 — `captchaValidator.ts` Shared Verification Utility

**Problem:** Turnstile and reCAPTCHA v3 both follow the same `/siteverify` pattern. Duplicating the HTTP call + error handling per-function would violate DRY.

**Decision:** `functions/src/utils/captchaValidator.ts` exports two pure functions:
- `verifyTurnstileToken(token, secret, remoteip?)` → `CaptchaResult`
- `verifyRecaptchaToken(token, secret, action?, remoteip?)` → `CaptchaResult`

reCAPTCHA v3 specifics:
- Silent scoring (no UI widget) — score in [0.0, 1.0]; threshold `RECAPTCHA_MIN_SCORE = 0.5`
- `action` param prevents cross-action token replay (mismatch → `action-mismatch` error code)
- Raise threshold to 0.7 for high-risk actions (delete, export)

**Secret names in Secret Manager:** `TURNSTILE_SECRET`, `RECAPTCHA_SECRET`.

---

## Decision 29 — GCS Object Retention for Immutable Backups

**Problem:** The existing Firestore backup bucket (`actionstation-244f0-firestore-backups`) had no retention policy. Backups could be deleted by any project owner — including via ransomware or insider action.

**Decision:** `scripts/setup-immutable-backups.sh` creates `actionstation-244f0-firestore-backups-immutable` with:
- **30-day GCS object retention policy** — objects cannot be deleted or overwritten for 30 days after write
- **Optional irrevocable lock** — once locked, the 30-day minimum cannot be reduced or removed by anyone (including Google Support)
- **Object versioning** — overwritten objects become non-current versions; non-current versions deleted after 90 days
- **Uniform bucket-level access** (required for retention policies)

**Migration path:** After running the script, update `BACKUP_BUCKET` in `functions/src/firestoreBackup.ts` to the new bucket name and redeploy. Keep the old bucket as a read-only archive until all objects exceed 30 days, then delete it.

**Why a new bucket:** Retention policies only apply to objects written _after_ the policy is set. A fresh bucket guarantees every backup object is born under retention protection.

---

## Standing Rules Added (WAF / CAPTCHA Sprint)

1. **`verifyTurnstile` before login/upload** — client must call `POST /verifyTurnstile` and receive 200 before proceeding to Firebase Auth or Cloud Storage upload
2. **`IP_RATE_LIMIT_CAPTCHA = 10`** — captcha-verify endpoint is public (pre-auth), so IP-only rate limiting at a tighter limit than other endpoints
3. **Validate reCAPTCHA `action` string** — always pass the action name to detect token replay; mismatch → block
4. **Immutable bucket for all backups** — `firestoreBackup.ts` must target the `-immutable` bucket; old bucket is read-only archive only

---

## Decision 30 — Tailwind-First, No New CSS Module Files (Mar 17 2026)

**Problem:** Ongoing Tailwind migration left some component `.tsx` files still importing `.module.css` files. New features were being implemented in a mix of CSS modules and Tailwind, causing inconsistency and double-maintenance.

**Decision:** All new component styling uses **Tailwind utility classes only**. No new `.module.css` files are created. When a `.tsx` file is modified for any reason, its entire `.module.css` is migrated to Tailwind in the same commit and the `.module.css` file deleted.

**Critical spacing rule (CLAUDE.md §CSS→TAILWIND):**
`src/styles/global.css` has a bare `* { margin: 0; padding: 0 }` reset that overrides Tailwind's `@layer utilities`. This means **Tailwind spacing utilities (`mt-*`, `px-*`, `gap-*`) produce zero spacing** and must never be used. Use `style` props for all `margin`, `padding`, and `gap` values.

```tsx
// ❌ FORBIDDEN — zeroed by global * reset
<div className="p-4 gap-2 mt-3">

// ✅ CORRECT — spacing via style prop; layout/color via Tailwind
<div className="flex items-center rounded-[var(--radius-md)] bg-[var(--color-surface)]"
     style={{ padding: 'var(--space-md)', gap: 'var(--space-sm)' }}>
```

**What NEVER gets migrated to Tailwind:**
- `src/styles/variables.css` / `src/styles/themes/*.css` — design tokens and runtime theme switching
- `src/styles/global.css` / `src/styles/semanticZoom.css` — global resets, canvas viewport rules
- ProseMirror/TipTap global selectors (`:global(.ProseMirror ...)`) — must stay in `TipTapEditor.module.css`
- Canvas layout with `position: absolute`, ReactFlow transforms — Tailwind insufficient

**Highlight feature (Mar 17 2026):** `EditorBubbleMenu.module.css` deleted; `EditorBubbleMenu.tsx`, `LinkButtonItem.tsx`, `HighlightSwatches.tsx` are Tailwind-only. `TipTapEditor.module.css` retains the `.ProseMirror mark` rule because it is a ProseMirror global selector.

---

These rules were codified as a result of the sprint:

1. **Primitive selectors in `useEffect` deps** — select `s.user?.id`, not `s.user`
2. **`useRef` mirrors for `useCallback` deps** — never include reactive Zustand state in callback deps
3. **Single outer `try/catch` in async `useEffect`** — code before `try{}` must not be able to throw and leave state unresolved
4. **`.catch()` on all fire-and-forget async** — `void fn()` is forbidden without a `.catch(logger.warn)`
5. **`chunkedBatchWrite` for large writes** — raw `writeBatch` is limited to 500 ops; anything larger must use the chunked helper
6. **`crypto.randomUUID()` for all IDs** — `Date.now()` is forbidden for entity IDs
7. **`useDebouncedCallback` for all search/filter inputs** — 250 ms minimum delay
8. **Heavy computation in Web Worker** — TF-IDF, clustering, similarity go through `knowledgeWorkerClient`

---

## Phase 6 Security Hardening TDD Sprint — Apr 20 2026

### Context
Implemented the Phase 6 plan (`plans/PHASE-6-SECURITY-HARDENING.md`) in five TDD sub-phases. All 16,015 frontend tests and 425 function tests pass. `npm run build` succeeds with 0 errors.

---

## Decision 31 — Unicode Normalisation Pipeline for Prompt Injection Defence

**Problem:** Cyrillic/Greek homoglyphs (е=\u0435, о=\u043E, etc.) are separate Unicode codepoints — NFKD alone does not decompose them. An attacker can spell `ignore` as `іgnоrе` to bypass regex-based injection detection.

**Decision:** `functions/src/utils/textNormalizer.ts` implements a 3-step pipeline applied in `promptFilter.ts` before all pattern matching:

1. **NFKD decomposition** — decomposes ligatures (ﬁ→fi), fullwidth chars (Ａ→A), superscripts
2. **Combining mark strip** — `text.replace(/\p{Mn}/gu, '')` removes diacriticals without triggering ESLint `no-misleading-character-class`
3. **Confusables map** — `Array.from(text).map(ch => MAP[ch] ?? ch).join('')` maps 32 Cyrillic/Greek chars to ASCII equivalents (char-by-char iteration avoids dynamic regex construction)

**Critical invariant:** Length checks run on ORIGINAL text; pattern tests run on NORMALIZED text. This prevents an attacker from padding with confusables to inflate their "clean" character count while the payload stays under limits.

**ESLint lesson:** `\p{Mn}` (Unicode property escape) is the correct alternative to character class ranges for combining marks — avoids `no-misleading-character-class` while remaining Unicode-aware.

**Files:** `functions/src/utils/textNormalizer.ts` (new, 49 tests), `functions/src/utils/promptFilter.ts` (modified — import + apply normalizer), `functions/src/utils/__tests__/promptFilter.test.ts` (+7 homoglyph bypass tests)

---

## Decision 32 — Structural Tests as CI Gatekeepers for Infrastructure Coverage

**Problem:** New Cloud Functions could be added without corresponding WAF protection or monitoring alerts — the gap would only be discovered in production when an unprotected endpoint gets hit.

**Decision:** Two structural tests in `src/__tests__/` enforce infrastructure coverage at CI time:

- `cloudArmorCoverage.structural.test.ts` — parses `functions/src/index.ts` exports with regex, parses the `SERVICES=()` array from `scripts/setup-cloud-armor.sh`, asserts bidirectional coverage. Also asserts priority-850 webhook rate-limit rule exists in the script.
- `monitoringCoverage.structural.test.ts` — asserts `auth_failure_spike` and `bot_detected_spike` log-based metrics plus their CRITICAL/HIGH alert policies are defined in `scripts/setup-monitoring-alerts.sh`.

**Pattern:** These tests parse shell scripts and TypeScript with regex rather than executing them — fast, side-effect-free, and suitable for CI.

**Lesson (during 6.2):** `calendarCreateEvent` lowercases to `calendarcreateevent` (two e's — "create" + "event" both end/start with e). The structural test caught a typo in the script where it had been spelled `calendarcreateevent` vs the correct double-e. Always trust the structural test over manual counting.

**Files:** `src/__tests__/cloudArmorCoverage.structural.test.ts` (new), `src/__tests__/monitoringCoverage.structural.test.ts` (new), `scripts/setup-cloud-armor.sh` (fixed typo + 11 missing services + priority-850 rule), `scripts/setup-monitoring-alerts.sh` (auth_failure + bot_detected metrics/alerts/Slack)

---

## Decision 33 — Turnstile Hook + Login Integration (Code Complete, Deployment Pending)

**Problem:** `useTurnstile.ts` and `LoginPage.tsx` were complete but had no regression test coverage. The `VITE_TURNSTILE_SITE_KEY` env var is absent by default in test environment — tests needed a pattern to test both no-key (no-op) and with-key (full challenge) modes without contaminating each other.

**Decision:** 
- `useTurnstile.test.ts` (no-key + success) and `useTurnstile.failure.test.ts` (403 + network error) — split at 193/161 lines to stay under 300-line limit
- Pattern: `vi.resetModules()` + `vi.stubEnv('VITE_TURNSTILE_SITE_KEY', ...)` + `await import('../hooks/useTurnstile')` in `beforeEach` — required because the env var is captured at module initialization time (module-level constant)
- `LoginPage.test.tsx` uses `vi.hoisted()` for mock functions that must be available to the `vi.mock()` factory before hoisting reorders execution
- `window.turnstile` mocked via `vi.stubGlobal` with `getResponse` returning token immediately — avoids the `pollForToken` `setTimeout` loop in the hook

**Deployment remaining:** Create Cloudflare Turnstile site → store `TURNSTILE_SECRET` in Secret Manager → add `VITE_TURNSTILE_SITE_KEY` to GitHub Secrets → deploy.

**Files:** `src/features/auth/__tests__/useTurnstile.test.ts` (9 tests), `src/features/auth/__tests__/useTurnstile.failure.test.ts` (7 tests), `src/features/auth/__tests__/LoginPage.test.tsx` (+4 Turnstile interaction tests)

---

## Decision 34 — `ipRateLimiter.ts` is Firestore-Backed in Production (No Per-Instance Risk)

**Finding:** A review question arose: does `ipRateLimiter.ts` have a distributed consistency problem if Cloud Run spawns multiple instances?

**Answer:** No. `isDeployedFunction()` = `!!process.env.K_SERVICE && FUNCTIONS_EMULATOR !== 'true'`. Cloud Run sets `K_SERVICE` automatically → Firestore-backed path in production. The in-memory `Map` fallback only runs in the local emulator and test suite. A clarifying comment was added to the file header.

**Files:** `functions/src/utils/ipRateLimiter.ts` (production safety comment added)
