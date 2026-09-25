# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# ActionStation - Project Rules

> **CRITICAL**: ZERO TECH DEBT policy. All rules are NON-NEGOTIABLE.

## 📍 Current Status

- **Main branch**: Phases 1-9 + Phase 6 security hardening complete (code-side)
- **Deployment pending**: Cloud Armor WAF, Turnstile env vars, Monitoring alerts — all scripts ready, awaiting production GCP run
- **Docs map**: [`docs/README.md`](./docs/README.md) — read it to find the right doc. Payments: [`docs/payments/PAYMENT-STATE.md`](./docs/payments/PAYMENT-STATE.md) (Razorpay LIVE for ActionStation since 2026-09-24; SSBMax on test keys)
- **Full roadmap**: See [`PRODUCTION-LAUNCH-PLAN.md`](./plans/PRODUCTION-LAUNCH-PLAN.md)
- **Launch SSOT**: [`docs/launch/LAUNCH-CHECKLIST.md`](./docs/launch/LAUNCH-CHECKLIST.md) — every sprint starts by reading it and ends by ticking items with evidence. Add new blockers there before working on them. Goal: Gold Standard BASB web app.

## 🛠️ Development Commands

```bash
npm run check                   # typecheck + lint + test (run before commits)
npm run lint                    # eslint (max 49 warnings); lint:strict = zero warnings, enforced pre-merge
npm run build:quick             # tsc -b + vite build (skip lint/test)
cd functions && npm run check   # Cloud Functions: lint + test + build (separate Node 22 package)
firebase emulators:start --only functions  # Local emulator on :5001
```

**Aliases & Setup**: `@/` maps to `src/` (tsconfig.json, vite.config.ts). First-time setup: `cp .env.example .env.local` then fill in all `VITE_*` variables. Tests use Vitest + jsdom + React Testing Library, setup in `src/test/setup.ts`. Structural tests (`src/__tests__/`) enforce build rules — never update them, fix the code.

## 📚 Docs Discipline

- Docs map: `docs/README.md`. Every doc under `docs/`, `plans/`, `mydocs/` carries a status line: `> **Status: Current** · Last reconciled: YYYY-MM-DD (scope)` or `Status: Historical|Proposal|Superseded`. `docsIntegrity.structural.test.ts` enforces it, keeps docs listed in the map, checks that paths they cite exist, and fails when a Current doc is older than 90 days.
- Any change to payments, secrets, webhooks, deploys, monitoring or other infrastructure updates `docs/payments/PAYMENT-STATE.md` (payments) and the launch checklist **in the same PR**, with evidence. Long evidence goes in `docs/launch/LAUNCH-EVIDENCE.md`; dated history in `docs/launch/LAUNCH-CHANGELOG.md`; keep one-liners in the checklist.
- Never tick or restate a live-system fact from memory. Verify it, then update the doc's `Last reconciled` date. Live facts (Razorpay, GCP consoles) can only be re-verified by checking them.

## 🧠 Product Context — Building a Second Brain (BASB)

ActionStation captures, organizes, and synthesizes ideas on an infinite canvas. Every feature must reduce friction between thought and capture, or between capture and insight.

## 🚨 STRICT LIMITS

| Rule | Limit | Action |
|------|-------|--------|
| File Size | MAX 300 lines | Split immediately |
| Component | MAX 100 lines | Extract sub-components |
| Function | MAX 50 lines | Extract helpers |
| Hook | MAX 75 lines | Split by responsibility |

## 🏗️ ARCHITECTURE (MVVM + Feature-First)

Every new Cloud Function export must be added to: `functions/src/index.ts` (with `cors: ALLOWED_ORIGINS`), `scripts/setup-cloud-armor.sh` SERVICES array, and verified by the `cloudArmorCoverage` + `monitoringCoverage` structural tests.

**Multi-Tab Write Protection**:

A BroadcastChannel-based leader election (`src/shared/services/tabLeaderService.ts`) ensures only one tab writes to Firestore at a time:
- `TabLeaderProvider` (in `App.tsx`) runs the election and updates both `TabLeaderCtx` and `tabRoleStore`
- `useTabRoleStore` is a minimal Zustand store for **imperative reads** (e.g. in `useSaveCallback.save()` before Firestore writes)
- `useTabLeaderRole()` is the React hook for **reactive reads** in components
- Default role is `'pending'` → `isLeader: false`, so no writes occur during the election window
- `MultiTabBanner` renders for follower tabs; followers still update the local cache

**Structural Tests Catalog** (`src/__tests__/`):

These tests act as compile-time guardrails — they fail the build if rules are violated. When adding a new feature, check which tests it might affect:

| Test | What it enforces |
|------|-----------------|
| `zustandSelectors.structural.test.ts` | All store hooks must use selectors, no bare destructuring |
| `firestoreQueryCap.structural.test.ts` | Every `getDocs` must use `.limit()` |
| `noBase64InFirestore.structural.test.ts` | `stripBase64Images()` called in all node write paths |
| `overflowClip.structural.test.ts` | `overflow-clip` not `overflow-hidden` on fixed containers |
| `noConsoleLog.structural.test.ts` | No `console.*` in `src/` — use `logger.ts` |
| `envValidation.structural.test.ts` | New env vars registered in `envValidation.ts` |
| `cloudArmorCoverage.structural.test.ts` | New Cloud Functions in WAF `SERVICES` array |
| `monitoringCoverage.structural.test.ts` | New Cloud Functions covered by monitoring alerts |
| `cspCompleteness.structural.test.ts` | CSP in `firebase.json` only, never `<meta>` tags |
| `guardrails.security.structural.test.ts` | Stripe key not in client bundle, base64 invariants |
| `landingPage.structural.test.ts` | Landing routes accessible without auth |
| `docsIntegrity.structural.test.ts` | Docs have a status line, are listed in `docs/README.md`, cite existing paths, and Current docs are ≤90 days old |

## 🔴 HARDCODING RULES (Zero Tolerance)
- **Strings**: Use `strings` from `@/shared/localization/*` — no inline text
- **Colors**: Use `var(--color-*)` CSS variables — no hex/rgb
- **Spacing**: Use `var(--space-*)` design tokens or inline `style` props
- **Secrets**: Never in code — `.env.local` locally, env vars in CI/CD

## 🎨 CSS → TAILWIND INCREMENTAL MIGRATION

**Golden Rule**: When you modify a component's `.tsx`, migrate its **entire** `.module.css` to Tailwind in the **same PR**. Never partially convert.

**What migrates**: `.module.css` files and hardcoded `style={{}}` props → Tailwind utilities + inline `style` for spacing.

**What NEVER migrates**: `src/styles/` (variables, themes, global resets), Canvas layout (position/transforms/ReactFlow overrides), custom scrollbars, Tailwind spacing utilities (broken by global `* { margin: 0; padding: 0 }` reset).

**Rule for spacing**: Use `style` props for `margin`, `padding`, `gap` (the global reset kills Tailwind spacing). Use Tailwind only for layout (`flex`, `items-center`), colors, borders, radius, shadows.

**Fixed-height containers**: Always use `overflow-clip` (not `overflow-hidden`) on modals/panels/dialogs to prevent focus-scroll bugs.

**Hard rules**: (1) All-in or leave it — no partial migrations. (2) Delete `.module.css` when done. (3) No new `.module.css` files. (4) Theme colors: `bg-[var(--color-primary)]`, never `bg-blue-500`. (5) Canvas components last. (6) Spacing via `style` props.

## 🔐 SECURITY PROTOCOL

**Firestore rules**: Deny-all by default. Every path requires `request.auth.uid == userId`. Always guard `resource.data` with `resource == null` check (resource is null on creates).

**API Protection**: 
- Gemini API calls via Cloud Function proxy (never direct client)
- Firebase App Check enabled (recaptcha v3)
- Base64 images stripped before Firestore writes (`stripBase64Images()`)
- No `data:` URIs in CSP `img-src` directive
- CSP lives **only** in `firebase.json` headers — never add `<meta>` tags

**Security Invariants** (non-negotiable):
1. `VITE_GEMINI_API_KEY` must **never** appear in CI/deploy.yml
2. CSP in `firebase.json` only
3. New env vars: add to **both** `envValidation.ts` AND `envValidation.structural.test.ts`
4. New Cloud Functions: export from `functions/src/index.ts` with `cors: ALLOWED_ORIGINS`
5. `npm audit` must stay at 0

**Cloud Function Security Layer**: Bot detection → IP rate limit → Auth → User rate limit → Prompt filter → Output scan. See `functions/src/utils/` for `botDetector.ts`, `ipRateLimiter.ts`, `promptFilter.ts`, `threatMonitor.ts`, `securityLogger.ts`.

**Prompt Injection Hardening**: `promptFilter.ts` applies `normalizeForPatternMatch()` before pattern matching — 3-step pipeline: NFKD decomposition → `\p{Mn}` combining-mark strip → confusables map (Cyrillic/Greek → ASCII). Length checks always run on ORIGINAL text; patterns run on normalized text (prevents confusable-padding bypass). See `functions/src/utils/textNormalizer.ts`.

**WAF / CAPTCHA**: `scripts/setup-cloud-armor.sh` provisions Cloud Armor WAF + HTTPS LB for all Cloud Functions (run once per project). Turnstile CAPTCHA is code-complete — needs `VITE_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET` in Secret Manager to activate.

**Monitoring**: `scripts/setup-monitoring-alerts.sh` creates `auth_failure_spike` and `bot_detected_spike` log-based metrics with CRITICAL/HIGH alert policies. Structural tests enforce that any new Cloud Function export is added to the WAF SERVICES array.

## 📦 STATE MANAGEMENT (Zustand + TanStack Query)

**Pattern**: Zustand for local/UI state (canvas, selections). TanStack Query for server state.

### 🔴 CRITICAL: Selector Pattern (Mandatory)

Bare store subscriptions cause infinite loops in ReactFlow. Always use selectors for state, `getState()` for actions:

```typescript
// ✅ CORRECT
const user = useAuthStore((s) => s.user);
const isLoading = useAuthStore((s) => s.isLoading);
const handleSubmit = () => useAuthStore.getState().setUser(newUser);

// ❌ WRONG
const { user, isLoading, setUser } = useAuthStore();
```

### 🔴 CRITICAL: useCallback Deps

Never include reactive Zustand state in `useCallback` deps — use `useRef` instead:

```typescript
// ✅ CORRECT
const userRef = useRef(user);
userRef.current = user;
const handleAction = useCallback(() => {
    const u = userRef.current; // always fresh
}, []); // stable reference

// ❌ WRONG
const handleAction = useCallback(() => { ... }, [user]); // recreated on every change
```

### 🔴 CRITICAL: useEffect Deps

Select primitive values, not object references:

```typescript
// ✅ CORRECT
const userId = useAuthStore((s) => s.user?.id);
useEffect(() => { ... }, [userId]);

// ❌ WRONG
const user = useAuthStore((s) => s.user);
useEffect(() => { ... }, [user]); // re-runs on any store change
```

## 📚 Feature Skills (load on demand)

Free-tier limits → `/free-tier-limits`; legal/consent → `/legal-compliance`; tile-based storage → `/spatial-chunking`. Read the matching skill before changing those areas.

## 🗄️ FIRESTORE PATTERNS

**Query safety**: All `getDocs` **must** use `.limit(FIRESTORE_QUERY_CAP)` from `firestoreQueryConfig.ts`. Structural test enforces this.

**Write safety**: 
- ≤500 ops: use `runTransaction()`
- >500 ops: use `chunkedBatchWrite()` from `firebaseUtils.ts`
- Never create raw `writeBatch` with unlimited ops

**Schema versioning**: Every workspace/node carries `schemaVersion: number`. On load, `migrationRunner.ts` applies pending migrations. Migrations must be pure, idempotent, backward-compatible.

**Bundle-first loading**: `loadUserWorkspaces` tries `loadWorkspaceBundle()` first (fast, cached). Falls back to direct Firestore queries if unavailable.

## ⚡ PERFORMANCE RULES (ReactFlow 500+ Nodes)

- **Memoize custom nodes**: `React.memo(({ data }: NodeProps) => { ... })`
- **Never destructure store directly in render**: Use scalar selectors
- **Decouple selection state**: `const selectedNodeIds = useStore(s => s.selectedNodeIds)`
- **Lazy render**: `<ReactFlow onlyRenderVisibleElements={true} />`
- **Heavy computation off-thread**: Use Web Worker client (`computeClustersAsync`, `rankEntriesAsync`)
- **Search debouncing**: Use `useDebouncedCallback(search, 250)`

## 🆔 ID GENERATION & CONSTANTS

```typescript
// ✅ ALWAYS use crypto.randomUUID() for node/edge IDs
const id = `idea-${crypto.randomUUID()}`;
const edgeId = `edge-${crypto.randomUUID()}`;

// ❌ NEVER use Date.now() — collision risk under rapid creation
```

## 🧪 TDD PROTOCOL (STRICT)

1. **Ask for acceptance criteria** before designing feature/fix tests. User defines what "done" means.
2. Write failing test first
3. Minimal code to pass
4. Refactor while green
5. Commit only when tests pass

**Test Coverage Minimums**:
| Layer | Minimum |
|-------|---------|
| Stores | 90% |
| Services | 85% |
| Utils | 100% |
| Hooks | 80% |
| Components | 60% (critical paths) |

## 🎨 CODE STYLE

**Imports order**: React/framework → External libs → `@/` internal → Relative imports. Use `import type` for types.

**TypeScript**: Use `interface` (not `type`). `readonly T[]`. Prefer `null` over `undefined`. `as const` for literals. NO `any`.

**Naming**: kebab-case for components (`idea-card.tsx`), camelCase for non-components. PascalCase components. Hooks: `useXxx`. Constants: `SCREAMING_SNAKE_CASE`. Booleans: `is`, `has`, `should`, `can` prefix.

**Commit format**: `type(scope): description`
| Type | Use |
|------|-----|
| feat | New feature |
| fix | Bug fix |
| refactor | Code change |
| test | Tests |
| docs | Documentation |
| perf | Performance |
| security | Security fix |

## 🧹 LOGGING & ERROR HANDLING

Always use structured logger, never `console.*`:

```typescript
import { logger } from '@/shared/services/logger';
logger.error('message', error, { contextKey: value }); // → Sentry + console
logger.warn('message', ...args);
```

Fire-and-forget async calls must have `.catch()`. `useEffect` async functions need single outer try/catch wrapping setup code.

## 💰 COST MINIMISATION

**Firestore**: Query caps, batch writes, bundle-first loading, tile eviction (enforced via rules).

**Gemini**: No speculative calls. Cache AI results. Use focused KB context. All calls via proxy. Prefer client-side computation (TF-IDF Web Worker).

**Cloud Functions**: `minInstances` OFF pre-launch. Re-add `minInstances: 1` to payment webhooks only when production traffic starts.

## 🚀 PRODUCTION LAUNCH PHASES


See [`PRODUCTION-LAUNCH-PLAN.md`](./plans/PRODUCTION-LAUNCH-PLAN.md) for full roadmap with acceptance criteria and test coverage.

## ✅ TECH DEBT PREVENTION CHECKLIST

Before ANY commit:
1. `npm run lint` → 0 errors
2. `npm run test` → 100% pass
3. `npm run build` → success
4. Files: `find src -name "*.ts*" | xargs wc -l | awk '$1 > 300'` → empty
5. Strings: No inline text in components
6. IDs: No `Date.now()` for entity IDs — use `crypto.randomUUID()`
7. Selectors: No object references in `useEffect` deps — use primitive selectors
8. Callbacks: No reactive Zustand state in `useCallback` deps — use `useRef`

**NO EXCEPTIONS. NO "TODO: fix later". NO SHORTCUTS.**
