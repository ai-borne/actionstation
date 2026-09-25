# BASB Production Readiness Audit — 17 March 2026

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

---

## Summary Scorecard

| Category | Status | Notes |
|---|---|---|
| Repository Health | ⚠️ WARNING | Build artifacts + screenshot PNGs committed |
| Dependency Security | ⚠️ WARNING | 9 HIGH, 3 MODERATE vulns (all build-time/transitive) |
| Secrets Exposure | ✅ PASS | No hardcoded secrets; Gitleaks in CI |
| Build Stability | ✅ PASS | Build, lint, typecheck, 5049 tests all green |
| Code Quality | ✅ PASS | Strict TS, ESLint 0-warnings, minimal `any` usage |
| Performance | ✅ PASS | Workers, memoization, PWA present; one bundle concern |
| Security Hardening | ⚠️ WARNING | CSP via meta tag only; 4 HTTP headers absent |
| API Security | ✅ PASS | Auth, rate limits, body limits, SSRF guards all present |
| Authentication Safety | ✅ PASS | Firestore deny-by-default; server-only subscription writes |
| AI Safety | ✅ PASS | Prompt injection filter, token caps, server-side key |
| Deployment Readiness | ⚠️ WARNING | `VITE_CLOUD_FUNCTIONS_URL` missing from deploy.yml |

---

## Section Findings

---

### 1. Repository Health

**Clean items:**
- No `.env` files committed — `.gitignore` explicitly excludes `.env.local` ✅
- No `console.log` in production source — all logging routes through `src/shared/services/logger.ts` ✅
- Zero `TODO` / `FIXME` markers in `src/` ✅
- Gitleaks runs on every PR (`.github/workflows/ci.yml`) ✅

**Issues found:**

| Severity | File(s) | Issue |
|---|---|---|
| ⚠️ | `wave6-footer-fixed.png`, `wave6-full-page-fixed.png`, `wave6-sidebar-current.png`, `wave6-sidebar-fixed.png`, `wave6-sidebar-zoomed.png`, `wave6-toolbar-fixed.png` | ~1.7 MB of screenshot PNGs committed to repo root — documentation artifacts, not app assets |
| ⚠️ | `tsconfig.tsbuildinfo`, `tsconfig.node.tsbuildinfo`, `dist-node/` | TypeScript build cache artifacts committed to git, polluting history |

---

### 2. Dependency Security

`npm audit` result: **9 HIGH, 3 MODERATE, 0 CRITICAL**

| Severity | Package | Issue | Location | Fix |
|---|---|---|---|---|
| HIGH | `rollup` ≥4.0 <4.59 | Arbitrary file write via path traversal (GHSA-mw96-cpmx-2vgc) | build-time transitive | `npm audit fix` |
| HIGH | `serialize-javascript` ≤7.0.2 | RCE via RegExp/Date (GHSA-5c6j-r48x-rmvq) | transitive via `vite-plugin-pwa` | `npm audit fix --force` (breaking: downgrades to `vite-plugin-pwa@0.19.8`) |
| HIGH | `undici` ≤6.23.0 | WebSocket overflow, HTTP smuggling, CRLF injection (5 CVEs) | transitive | `npm audit fix` |
| HIGH | `flatted` | Unbounded recursion DoS in `parse()` | transitive | `npm audit fix` |
| HIGH | `minimatch` | ReDoS via repeated wildcards | transitive | `npm audit fix` |
| HIGH | `underscore` ≤1.13.7 | DoS via `_.flatten` / `_.isEqual` | transitive | `npm audit fix` |
| HIGH | `workbox-build`, `@rollup/plugin-terser`, `vite-plugin-pwa` | Inherit `serialize-javascript` vuln | dev | `--force` |
| MODERATE | `dompurify` | XSS vulnerability | transitive | `npm audit fix` |
| MODERATE | `ajv` | ReDoS via `$data` option | transitive | `npm audit fix` |
| MODERATE | `markdown-it` | ReDoS | transitive | `npm audit fix` |

**Context:** All vulnerable packages are build-time tools or transitive dev dependencies — none ship in the production JS bundle. The `dompurify` XSS issue is the only one with runtime relevance, and it is not directly imported in production source (confirmed by grep). Running `npm audit fix` resolves 10 of 12; the remaining 2 (`serialize-javascript` chain) require `--force`.

**CI gap:** `npm audit --audit-level=high` is not in `.github/workflows/ci.yml` — new vulnerabilities would not block PRs.

---

### 3. Secrets & Credentials

| Item | Status |
|---|---|
| Hardcoded API keys (`AIza...`) | ✅ None found; CI gate enforces this |
| `.env.local` committed | ✅ Not committed |
| Gemini key isolation | ✅ `VITE_GEMINI_API_KEY` referenced only in `src/features/knowledgeBank/services/geminiClient.ts`; CI gate verifies this |
| Cloud Function secrets | ✅ `GEMINI_API_KEY` and `GOOGLE_CLIENT_SECRET` stored in Google Cloud Secret Manager via `defineSecret()` |
| Gitleaks scanning | ✅ Runs on every push and PR with `continue-on-error: false` |
| Bearer tokens in tests | ✅ All occurrences are mock strings in `__tests__/` files only |

---

### 4. Environment Configuration

**Documented in** `.env.example` ✅

**Required production variables** (from `src/config/envValidation.ts`):

| Variable | In `deploy.yml`? |
|---|---|
| `VITE_FIREBASE_API_KEY` | ✅ |
| `VITE_FIREBASE_AUTH_DOMAIN` | ✅ |
| `VITE_FIREBASE_PROJECT_ID` | ✅ |
| `VITE_FIREBASE_STORAGE_BUCKET` | ✅ |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | ✅ |
| `VITE_FIREBASE_APP_ID` | ✅ |
| `VITE_CLOUD_FUNCTIONS_URL` | ❌ **MISSING** |
| `VITE_GOOGLE_CLIENT_ID` | ❌ **MISSING** |
| `VITE_SENTRY_DSN` | ✅ |
| `VITE_POSTHOG_KEY` | ✅ |

**Critical:** `VITE_CLOUD_FUNCTIONS_URL` is required for all Gemini AI features to route through the server-side proxy. It is validated by `validateProductionEnv()` at startup, but absent from `.github/workflows/deploy.yml`. Production AI calls will either fail or — if `VITE_GEMINI_API_KEY` were somehow set — bypass the proxy and expose the key client-side. `VITE_GOOGLE_CLIENT_ID` is needed for Google Calendar OAuth.

Note: `VITE_DEV_BYPASS_SUBSCRIPTION` is correctly absent from the deploy workflow — the subscription bypass cannot be accidentally enabled in production.

---

### 5. Build Stability

| Check | Result |
|---|---|
| `npm run build` | ✅ Succeeds in 4.93s |
| `npm run typecheck` (strict mode) | ✅ Zero errors |
| `npm run lint` (`--max-warnings 0`) | ✅ Zero warnings |
| `npm run test` | ✅ 528 test files, 5049 tests, 0 failures |

**Build warnings worth attention:**

- `knowledgeBankService.ts` is both statically imported (by KB hooks) and dynamically imported (by workspace loaders) — Rollup cannot move it to a separate chunk, defeating the intended code splitting.
- Same conflict on `storageService.ts`.

---

### 6. Static Code Quality

| Metric | Result |
|---|---|
| TypeScript `strict: true` | ✅ Enabled |
| `noUnusedLocals` + `noUnusedParameters` | ✅ Enabled |
| `noUncheckedIndexedAccess` | ✅ Enabled |
| `any` usage in production source | ✅ 3 instances, all legitimate (variadic generic in `useDebounce`, comment text) |
| ESLint max-warnings | ✅ 0 |
| No hardcoded hex/px values | ✅ CI structural tests enforce this |

---

### 7. Frontend Bundle Optimization

| Chunk | Raw | Gzip | Concern |
|---|---|---|---|
| `index-BhAdKPwn.js` (main app) | 1,161 KB | 361 KB | ⚠️ Too large |
| `vendor-firebase-DhFtPENC.js` | 878 KB | 233 KB | Expected for Firebase SDK |
| `MindmapRenderer-BbtRFvu2.js` | 631 KB | 218 KB | D3 + mindmap — acceptable isolated |
| `index-IMCLWQdC.js` (secondary) | 500 KB | 130 KB | ⚠️ Could split further |
| `pdf-CE_K4jFx.js` | 445 KB | 131 KB | Acceptable — PDF.js |
| `vendor-reactflow-CZIhdPs_.js` | 327 KB | 105 KB | Expected |
| `pdf.worker.min-wgc6bjNh.mjs` | 1,079 KB | uncompressed | Service worker cached — OK |

**Root cause of large main chunk:** The static import conflict on `knowledgeBankService.ts` and `storageService.ts` forces Rollup to include the entire KB service tree in the initial bundle rather than deferring it as a lazy chunk.

**Positive:**
- `vendor-analytics` (PostHog, 182 KB) is in a separate chunk and lazy-loaded after first paint ✅
- MindmapRenderer is its own isolated chunk ✅
- `LoginPage` is a separate chunk ✅

---

### 8. Performance Risks

| Area | Status |
|---|---|
| TF-IDF / clustering on main thread | ✅ Moved to Web Worker (`src/workers/knowledgeWorker.ts`) |
| Worker crash recovery | ✅ Max 3 crashes, then graceful sync fallback |
| IdeaCard re-renders | ✅ `React.memo` + `useCallback` |
| Semantic zoom (500+ nodes) | ✅ CSS `data-attribute` approach — zero React re-renders |
| Canvas node cap | ✅ Clustering capped at 500 nodes |
| PWA offline | ✅ Service worker with `CacheFirst` for static assets |
| Firebase Auth tokens in Cache API | ✅ Explicitly excluded from service worker caching |

---

### 9. Worker Usage

✅ **Main thread is protected.** TF-IDF ranking and graph clustering both run inside `src/workers/knowledgeWorker.ts` via `postMessage`. PDF.js uses its own `pdf.worker.min` asset. The worker client has a synchronous fallback if `Worker` is unavailable.

---

### 10. Security Hardening

**CSP** is set via `<meta http-equiv="Content-Security-Policy">` in `index.html`. It is well-scoped: `object-src 'none'`, `base-uri 'self'`, worker sources restricted, no `unsafe-eval`.

**Gaps in HTTP response headers** — the Firebase Hosting `headers` section is entirely absent from `firebase.json`:

| Header | Status | Risk |
|---|---|---|
| `Content-Security-Policy` | ⚠️ Meta tag only | Meta tag CSP does not support `frame-ancestors` (clickjacking) |
| `Strict-Transport-Security` | ❌ Missing | No HSTS; downgrade attacks possible |
| `X-Frame-Options` | ❌ Missing | Clickjacking risk (`frame-ancestors` via meta is not honored) |
| `Referrer-Policy` | ❌ Missing | Referrer leakage to third-party requests |
| `Permissions-Policy` | ❌ Missing | No restriction on camera/mic/geolocation access |

`'unsafe-inline'` in `style-src` is present but necessary for TipTap inline styles and Tailwind arbitrary values — acceptable given the tradeoff.

---

### 11. API Security (Cloud Functions)

| Control | Status |
|---|---|
| Firebase Auth required on all endpoints | ✅ `verifyAuthToken()` in every handler |
| Rate limiting per user per endpoint | ✅ 60 req/min Gemini, 20 req/min metadata, 30 req/min image proxy |
| Request body size cap | ✅ 100 KB for Gemini, validated before parsing |
| SSRF protection | ✅ URL scheme allow-list + blocked private IP ranges |
| Gemini API timeout | ✅ 30s via `AbortController` |
| CORS origins | ✅ Production domain + localhost only in `cors.json` |
| Firestore deny-by-default | ✅ Explicit `allow read, write: if false` at top level |
| Subscription writes | ✅ `allow write: if false` — server-only |

---

### 12. Authentication & Authorization

✅ Firebase Auth with Google Sign-In. Firestore rules enforce `request.auth.uid == userId` on every read/write path. No privilege escalation path found. Session tokens are Firebase ID tokens (JWTs); the SDK handles refresh. No auth tokens stored in service worker cache.

---

### 13. AI Safety

| Control | Status |
|---|---|
| Prompt injection filter | ✅ `INJECTION_PATTERNS` regex in `src/features/documentAgent/services/documentAgentPrompts.ts` |
| Filename sanitization | ✅ Path traversal characters stripped |
| User content in system prompt | ✅ Separated into `systemInstruction` field vs `contents` |
| Output token cap | ✅ `GEMINI_MAX_OUTPUT_TOKENS = 2048` enforced server-side |
| API key exposure | ✅ Cloud Secret Manager; never reaches client in production |
| Per-user rate limit | ✅ 60 req/min |

**Minor gap:** The `INJECTION_PATTERNS` list covers common English-language injection patterns but not Unicode homoglyph variants (e.g., Cyrillic "І" in `ІGNORE`). Low risk currently but worth hardening before scale.

---

### 14. Logging & Monitoring

**Assessment: Production-grade ✅**

- Sentry initialized before first render in `src/main.tsx`, with `tracesSampleRate: 0.1` in production
- `logger.info` no-ops in production; `logger.error` always forwards to Sentry
- PII redacted from Sentry breadcrumbs (query strings stripped)
- User context set/cleared on auth state changes (`setSentryUser` / `clearSentryUser`)
- PostHog analytics lazy-loaded after first paint, no-ops if key absent
- Web Vitals (CLS, LCP, FID) tracked via `src/shared/services/performanceService.ts`

---

### 15. Error Handling

- Top-level `<ErrorBoundary>` wraps entire app in `src/App.tsx` ✅
- Canvas-specific `MindmapErrorBoundary` isolates mindmap crashes ✅
- Error boundary shows `error.message` only — no stack traces exposed to users ✅
- All `logger.error` calls report to Sentry ✅

---

### 16. CI/CD Pipeline

| Gate | Present |
|---|---|
| TypeScript type check | ✅ |
| ESLint (`--max-warnings 0`) | ✅ |
| Unit + structural tests | ✅ |
| Production build verification | ✅ |
| Gitleaks secret scan | ✅ |
| `.env` leakage guard | ✅ |
| Gemini API key isolation guard | ✅ |
| `npm audit` | ❌ **Missing** |
| Deploy gated on all checks passing | ✅ |

---

### 17. Deployment Compatibility

Firebase Hosting is configured correctly: SPA rewrite in `firebase.json`, `dist/` as public folder, Cloud Functions co-located. The deployment workflow (`.github/workflows/deploy.yml`) runs full checks before deploying. No structural blocker for Vercel/Netlify if desired — would need a `vercel.json` / `netlify.toml` with equivalent SPA rewrites and the same env vars.

---

### 18. Production Configuration

| Item | Status |
|---|---|
| `VITE_APP_ENV: production` in deploy workflow | ✅ |
| `logger.info` silent in production | ✅ |
| `validateProductionEnv()` called at startup | ✅ |
| Dev subscription bypass disabled in production | ✅ (var not set in deploy.yml) |
| React StrictMode enabled | ✅ (acceptable in production) |

---

### 19. Observability

| Tool | Status |
|---|---|
| Sentry error tracking + session replay | ✅ Initialized, DSN via env var |
| PostHog product analytics | ✅ Lazy-loaded, key via env var |
| Web Vitals (CLS, LCP, FID) | ✅ `performanceService.ts` |

**Gaps:**
- No uptime monitoring (Checkly, Better Uptime, etc.)
- Cloud Functions emit structured logs to Firebase/Cloud Logging implicitly, but no log-based alerting is configured

---

## Critical Issues

### 1. `VITE_CLOUD_FUNCTIONS_URL` missing from `.github/workflows/deploy.yml`

**File:** `.github/workflows/deploy.yml` → `Build` step env block

Without this, production builds have `isProxyConfigured() === false`. The Gemini client falls back to `VITE_GEMINI_API_KEY`, which is also absent — causing **all AI features to silently fail at runtime**. Add to GitHub Secrets and the deploy workflow.

### 2. `VITE_GOOGLE_CLIENT_ID` missing from `.github/workflows/deploy.yml`

**File:** `.github/workflows/deploy.yml` → `Build` step env block

Google Calendar OAuth will not initialize. Add to GitHub Secrets and deploy workflow.

### 3. No HTTP response security headers in `firebase.json`

**File:** `firebase.json` → `hosting` section

`X-Frame-Options`, `Strict-Transport-Security`, `Referrer-Policy`, and `Permissions-Policy` are absent. The CSP `<meta>` tag does not enforce `frame-ancestors` (clickjacking protection requires a response header). Add a `headers` block:

```json
"headers": [
  {
    "source": "**",
    "headers": [
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
      { "key": "X-Content-Type-Options", "value": "nosniff" }
    ]
  }
]
```

---

## High Priority Fixes

### 1. Run `npm audit fix` (and `--force` for PWA chain)

Resolves 10 of 12 vulnerabilities immediately. The remaining 2 (`serialize-javascript` via `vite-plugin-pwa`) need `npm audit fix --force` which downgrades to `vite-plugin-pwa@0.19.8` — verify PWA offline behaviour still works after.

### 2. Add `npm audit --audit-level=high` to `.github/workflows/ci.yml`

Insert as a new job between `build` and `secret-scan`. Prevents future vulnerable dependencies from silently entering the dependency tree.

```yaml
audit:
  name: Dependency Audit
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    - run: npm ci
    - run: npm audit --audit-level=high
```

### 3. Fix static/dynamic import conflict on `knowledgeBankService.ts` and `storageService.ts`

**Files:** `src/features/knowledgeBank/hooks/useDocumentGroupHandlers.ts`, `src/features/knowledgeBank/hooks/useKnowledgeBankPanelHandlers.ts`, and others

Convert the static imports in KB hooks to dynamic `import()`, or consolidate all callers onto the same lazy-load path already used by the workspace loaders. This will allow Rollup to split the KB service tree out of the 1.16 MB main bundle.

---

## Recommended Improvements

### 1. Remove binary files and build artifacts from git

Add to `.gitignore`:
```
*.tsbuildinfo
dist-node/
wave6-*.png
screenshots/
```

Then purge from history with `git filter-repo` or BFG Repo Cleaner. This reduces clone size and eliminates ~1.7 MB of committed screenshots.

### 2. Expand prompt injection filtering

**File:** `src/features/documentAgent/services/documentAgentPrompts.ts`

Add Unicode homoglyph and obfuscation variants to `INJECTION_PATTERNS`. Low risk currently but recommended before public scale.

### 3. Upgrade CSP from `<meta>` to HTTP response header

Move the existing CSP string from `index.html` to the `firebase.json` `headers` block (see Critical Issue #3). This enables `frame-ancestors 'none'`, making `X-Frame-Options` redundant, and supports future nonce-based script policies.

### 4. Add uptime monitoring

Sentry and PostHog cover errors and behaviour; neither alerts on full-service outages. Add a lightweight external ping monitor (Checkly, Better Uptime, or Firebase Hosting health check) to the production URL.

### 5. Add `VITE_CLOUD_FUNCTIONS_URL` to `src/config/envValidation.ts` `REQUIRED_VARS`

**File:** `src/config/envValidation.ts`

`VITE_CLOUD_FUNCTIONS_URL` is used but not currently listed in `REQUIRED_VARS`, meaning a missing value would not trigger a startup error in production. Adding it gives an immediate Sentry alert rather than silent AI feature degradation.

---

*Audit performed: 17 March 2026 | Build: green (5049/5049) | TypeScript: strict | ESLint: 0 warnings*
