# ActionStation

AI-powered infinite whiteboard for creating, connecting, and synthesising ideas.

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 18, ReactFlow (canvas), TipTap (rich text) |
| State | Zustand (client), TanStack Query (server) |
| Backend | Firebase Auth, Firestore, Cloud Functions v2, Storage |
| AI | Gemini via Cloud Function proxy, Web Worker (TF-IDF / clustering) |
| Build | Vite, TypeScript strict, Vitest |
| Observability | Sentry (errors + structured logger), PostHog (analytics), web-vitals |

## Prerequisites

- Node.js ≥ 20
- Firebase CLI: `npm install -g firebase-tools`
- A Firebase project with Auth (Google provider), Firestore, Storage, and Functions enabled

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create local env file (never commit this)
cp .env.example .env.local
# Fill in all VITE_* variables (see below)

# 3. Start dev server
npm run dev
```

## Environment Variables

Create `.env.local` at the project root:

```env
# Firebase (client-safe — restricted by domain in Firebase Console)
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# Gemini AI (server-side only — set in Cloud Functions config)
# NEVER put this in .env.local
# GEMINI_API_KEY=

# Observability (optional — app works without these)
VITE_SENTRY_DSN=
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://app.posthog.com

# Environment label (defaults to Vite mode: development/production)
VITE_APP_ENV=development
```

## Scripts

```bash
npm run dev          # Dev server (http://localhost:5173)
npm run build        # Type-check + lint + test + build
npm run build:quick  # Build without checks (CI uses full build)
npm run test         # Run all tests (Vitest)
npm run test:watch   # Watch mode
npm run test:coverage
npm run lint         # ESLint (max 49 warnings)
npm run lint:strict  # ESLint (zero warnings — enforced pre-merge)
npm run typecheck    # tsc --noEmit
npm run check        # typecheck + lint + test (run before committing)
```

## Cloud Functions

```bash
cd functions
npm install
npm run build
firebase emulators:start --only functions  # Local emulator on :5001
firebase deploy --only functions           # Deploy
```

### Cloud Functions deployed

| Function | Trigger | Purpose |
|---|---|---|
| `geminiProxy` | HTTPS callable | Proxies all Gemini AI requests — key never reaches the client |
| `workspaceBundle` | HTTPS callable | Generates Firestore Bundles of workspace metadata for fast load |
| `onNodeDeleted` | Firestore `onDocumentDeleted` | Cleans up Storage files (images, attachments, thumbnails) when a node is deleted |
| `scheduledStorageCleanup` | Scheduler (daily) | Deletes orphan files in `tmp/` older than 7 days |

## Architecture

```
src/
├── features/          # Feature modules (MVVM, one domain per folder)
│   ├── auth/          # Firebase Auth + Google OAuth
│   ├── canvas/        # ReactFlow canvas, nodes, edges
│   ├── ai/            # Gemini generation + transformation
│   ├── workspace/     # Multi-workspace management + offline sync
│   ├── knowledgeBank/ # File/text KB with AI summarisation
│   ├── clustering/    # TF-IDF similarity + cluster suggestions
│   ├── search/        # Full-text node search with debounce
│   ├── subscription/  # Feature gates (free/pro)
│   └── tags/          # Node tagging
├── shared/
│   ├── components/    # Reusable UI (Button, Toast, ErrorBoundary)
│   ├── hooks/         # Generic hooks (useDebouncedCallback, useEscapeLayer)
│   ├── services/      # logger.ts, Sentry, PostHog, web-vitals
│   ├── stores/        # Shared Zustand stores (toast, confirm, settings)
│   ├── utils/         # Pure functions (firebaseUtils, contentSanitizer)
│   ├── localization/  # All user-facing strings (no inline strings)
│   └── validation/    # Zod schemas for all Firestore-bound inputs
├── migrations/        # Firestore schema migrations (idempotent, versioned)
├── workers/           # Web Workers (knowledgeWorker — TF-IDF off main thread)
├── app/               # App shell (Layout, routing context, hooks)
├── config/            # Firebase init, query client, firestoreQueryConfig
└── styles/            # CSS variables, global styles
```

### Key Architectural Decisions

**Zustand selector pattern is mandatory.** Bare destructuring from stores causes cascading re-renders with 500+ ReactFlow nodes. Always use:
```typescript
const user = useAuthStore((s) => s.user);               // ✅ selector
const { user } = useAuthStore();                        // ❌ forbidden
```
A structural test (`src/__tests__/zustandSelectors.structural.test.ts`) fails the build if anti-patterns are detected.

**`useCallback` deps must not include reactive Zustand state.** Instead, read live values via `useRef` and keep deps stable (`[]`). This prevents callback churn that feeds cascading re-renders in the workspace switcher and operations hooks.

```typescript
// ✅ CORRECT — stable callback reads live values via ref
const userRef = useRef(user);
userRef.current = user;
const handleAction = useCallback(async () => {
    const currentUser = userRef.current; // always fresh
}, []); // stable reference — no re-creation on every workspace switch
```

**`useEffect` deps must use primitive selectors, not object references.** Selecting `s.user` (object) causes the effect to re-run on every auth re-render even when `user.id` hasn't changed. Always select the primitive you actually need:

```typescript
const userId = useAuthStore((s) => s.user?.id); // ✅ string — stable
const user   = useAuthStore((s) => s.user);      // ❌ object — re-runs effect on auth refresh
useEffect(() => { ... }, [userId]);
```

**No hardcoded strings or colours.** All strings go in `src/shared/localization/strings.ts`. Colours use CSS variables from `src/styles/variables.css`.

**Gemini API key never reaches the client.** All AI calls go through `functions/src/geminiProxy.ts`.

**Base64 is stripped before every Firestore write.** `stripBase64Images()` in `contentSanitizer.ts` is called in `saveNodes` and `appendNode`. A structural test enforces this.

**All IDs use `crypto.randomUUID()`.** `Date.now()` is forbidden — two IDs created under 1ms would collide. This applies to nodes, edges, workspaces, and dividers.

**Web Worker for heavy computation.** TF-IDF scoring and similarity clustering run in `knowledgeWorker.ts` off the main thread. `knowledgeWorkerClient.ts` provides a Promise API with automatic main-thread fallback and a 3-crash spin-loop guard.

## Testing

Tests are co-located with source files in `__tests__/` directories. Coverage targets: Stores 90%, Services 85%, Utils 100%, Hooks 80%, Components 60%.

```bash
npm run test                    # All tests
npm run test:coverage           # With coverage report
```

## Deployment

**Preview (per-PR):** GitHub Actions deploys a Firebase Hosting preview channel on every pull request. The PR gets a comment with the preview URL.

**Production:** Merge to `main` triggers a full build + test + Firebase deploy.

Required GitHub Secrets:
- `FIREBASE_SERVICE_ACCOUNT` — service account JSON for Firebase deployment
- `VITE_FIREBASE_*` — all Firebase client config vars
- `VITE_SENTRY_DSN` — Sentry DSN
- `VITE_POSTHOG_KEY` — PostHog project key

## Scaling

See [docs/scaling-guide.md](docs/scaling-guide.md) for a phased plan covering 0→500→5K→50K+ users, including distributed rate limiting (Upstash Redis), per-user quotas, user tiers, and cost estimates.

## Firestore Architecture

```
users/{userId}/
  workspaces/{workspaceId}    # Workspace metadata + schemaVersion
    nodes/{nodeId}            # Individual nodes — userId + workspaceId on every doc
    edges/{edgeId}            # Individual edges — userId + workspaceId on every doc
  knowledgeBank/{entryId}     # KB entries
```

- Every node and edge document carries `userId` + `workspaceId` for defence-in-depth.
- Firestore rules validate `resource.data.userId == request.auth.uid` in addition to path-level checks.
- All queries are capped with `limit()` — see `src/config/firestoreQueryConfig.ts` for constants.
- Writes ≤500 ops use `runTransaction()` for read consistency; larger writes use `chunkedBatchWrite()` (500-op chunks).
- Schema migrations run on workspace load via `src/migrations/migrationRunner.ts` — idempotent and backward-compatible.
- Firestore Bundles serve frequently-accessed workspace metadata via `workspaceBundle` Cloud Function, cached in `sessionStorage` (5-min TTL).

## Storage Architecture

- Files are uploaded to Firebase Storage; only the download URL is written to Firestore.
- `stripBase64Images()` removes any base64 data from Firestore payloads before write.
- Storage lifecycle rules (`storage-lifecycle.json`) are applied to the GCS bucket on every production deploy via `gsutil lifecycle set` in `deploy.yml`.
- `onNodeDeleted` Cloud Function cleans up associated Storage files when a Firestore node document is deleted.
- `scheduledStorageCleanup` runs daily to purge `tmp/` files older than 7 days.

## Security

- Firestore rules enforce per-user data isolation (deny-all by default) + `userId` field validation
- Gemini API key hidden in Cloud Functions environment (never client-side)
- CSP header in `firebase.json` hosting headers (not a `<meta>` tag — needed for `frame-ancestors`) restricts script/connect sources; `data:` is not in `img-src` (image previews use `blob:` URLs instead, see `imageInsertService.ts`/`pasteImageService.ts`)
- OAuth token format validated before use
- Input validation via Zod on all Firestore-bound forms
- Base64 stripped from all Firestore node writes (`contentSanitizer.ts`)
- Secrets in `.env.local` only — never committed (enforced by `.gitignore`)
- Secret scanning in CI via Gitleaks
