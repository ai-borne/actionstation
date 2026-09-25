## Plan: Phase 7 — Edge Cases & Resilience

> **Status: Historical plan, tracked as section F of `docs/launch/LAUNCH-CHECKLIST.md`.**

**5 self-contained phases, ordered by risk + dependencies. Each delivers a green `npm run check`, full TDD, zero carried tech debt.**

---

### Phase A: Browser Compatibility (~2h)
**Goal:** Eliminate silent failures on older Safari/Firefox; declare explicit browser targets.

**Steps:**
1. Create `src/shared/utils/idUtils.ts` — exports `generateId(prefix: string): string` using `crypto.randomUUID()` with an inline manual UUID v4 fallback (`Math.random()` hex — no npm deps). This is the single canonical ID generator.
2. Write `src/shared/utils/__tests__/idUtils.test.ts` — 100% coverage: format validation, 10k-ID collision test, prefix passthrough.
3. Migrate all 15 src usages of `crypto.randomUUID()` to `generateId()`. functions stays untouched (Node 15+ always has `crypto.randomUUID()`).
4. Add `browserslist` to package.json: `["Chrome >= 92", "Firefox >= 90", "Safari >= 15.4", "Edge >= 92"]`.
5. `npm run check` → green.

**Tech Debt Incurred & Resolved:**
- ✅ Structural grep confirms zero `crypto.randomUUID()` remain in src after migration
- ✅ `browserslist` prevents ambiguous transpilation targets going forward

---

### Phase B: Network Resilience — Retry Layer (~4h)
**Goal:** Add exponential backoff to all Firestore write paths; rate-limit offline queue flush on reconnect.

**Steps:**
1. Add `withRetry<T>(fn, opts?)` to firebaseUtils.ts (currently 60 lines, well under 300). Retries on Firestore network/server codes (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `503`). **Does NOT retry** `PERMISSION_DENIED` / `UNAUTHENTICATED` — these must fail fast to preserve security invariants.
2. Write `src/shared/utils/__tests__/firebaseUtils.retry.test.ts` with `vi.useFakeTimers()` — success on 1st try, success on 2nd retry, max-retries exceeded (throws), auth errors NOT retried.
3. Apply `withRetry()` inside `chunkedBatchWrite()` wrapping each `batch.commit()`.
4. Apply `withRetry()` inside `batchDeleteCollection()`.
5. Wrap `saveNodes/saveEdges` in `useSaveCallback.ts` `save()` — network errors only.
6. Add **500ms rate limit** on offline queue flush in `useQueueDrainer` — prevents Firestore write spike on reconnect. Uses `useRef` timer, no `useCallback` dep changes.
7. `npm run check` → green.

**Tech Debt Incurred & Resolved:**
- ✅ All `batch.commit()` calls covered — no bare commit paths remain
- ✅ Auth errors still surface immediately (security invariant preserved)
- ✅ All retry logs via `logger.warn()` — no `console.*`

---

### Phase C: Concurrent Session Handling (~2 days) — *Highest Risk*
**Goal:** Leader-tab election ensures only one tab auto-saves. Follower tabs show a warning banner with "Take Over" option. All state isolated from canvas store.

**Sub-phase C1 — TabLeader Service (pure TypeScript, no React):**
1. `src/shared/services/tabLeaderService.ts` — state machine: `pending → leader | follower`. Uses `BroadcastChannel('actionstation-tab-leader')` with `localStorage` timestamp fallback (key: `'tab-leader-ts'`). Messages: `CLAIM_LEADERSHIP`, `RESIGN_LEADERSHIP`, `HEARTBEAT`. Tab focus triggers claim; tab blur triggers resign. Heartbeat every 3s while leader. Exports `createTabLeaderService()` factory with `{ start, destroy, claimLeadership, onRoleChange }`.
2. `src/shared/services/__tests__/tabLeaderService.test.ts` — 10+ cases covering all transitions with mock BroadcastChannel + `vi.useFakeTimers()`.

**Sub-phase C2 — useTabLeader Hook:**
3. `src/shared/hooks/useTabLeader.ts` — wraps service in React lifecycle. State held in **local `useReducer`** (`SET_ROLE` action). Returns scalar `{ isLeader: boolean }`. Zero Zustand dependency. (< 75 lines)
4. `src/shared/hooks/__tests__/useTabLeader.test.ts` — `renderHook`, mock BroadcastChannel, verify transitions.

**Sub-phase C3 — String Resources:**
5. `src/shared/localization/multiTabStrings.ts` — `anotherTabOpen`, `anotherTabDismiss`, `anotherTabTakeOver`, `anotherTabAriaLabel`. Import into `strings.ts` as `strings.multiTab`.

**Sub-phase C4 — MultiTabBanner Component:**
6. `src/shared/components/MultiTabBanner.tsx` — sticky banner when `!isLeader`: "Another tab has this workspace open. Auto-save is paused here." + "Take Over" button. Colors: `var(--color-warning)` / `var(--color-warning-text)`. No inline colors. Strings via `strings.multiTab.*`. (< 60 lines)
7. `src/shared/components/__tests__/MultiTabBanner.test.tsx` — renders when follower, hidden when leader, Take Over calls `claimLeadership`.

**Sub-phase C5 — TabLeaderContext (pure useReducer):**
8. `src/shared/contexts/TabLeaderContext.tsx` — `useReducer`-based context. State: `{ isLeader: boolean }`. Provides `useTabLeaderState()` + `useTabLeaderDispatch()`. Never imported by canvas store or ReactFlow. (< 80 lines)
9. `src/shared/contexts/__tests__/TabLeaderContext.test.tsx`.
10. `src/shared/services/__tests__/tabLeader.integration.test.ts` — two service instances, verify only one becomes leader, handoff on resign.

**Sub-phase C6 — Wire into App:**
11. In `App.tsx` `AuthenticatedApp`: add `<TabLeaderProvider>` **outside** `<ReactFlowProvider>` — critical for zero cascade risk.
12. In `useSaveCallback.ts`: read `useTabLeaderState().isLeader` — follower tabs skip Firestore writes, still update local refs + offline queue (no data loss).
13. `<MultiTabBanner />` mounted in `AuthenticatedApp` outside `ReactFlowProvider` tree.

**Tech Debt Incurred & Resolved:**
- ✅ `TabLeaderContext` never inside `ReactFlowProvider` — no cascade risk
- ✅ `BroadcastChannel` closed in `destroy()` — no memory leak
- ✅ Follower tabs still queue offline saves — no data silently dropped

---

### Phase D: Large Workspace Polish (~3h)
**Goal:** Tile-level retry with graceful failure UI; analytics on tile load failures.

**Steps:**
1. Apply `withRetry()` (Phase B) to `tileLoader.ts` `fetchTile()` — 3 retries, 500ms base delay.
2. Add `TILE_FAILED` + `RETRY_TILE` actions to `tileReducer.ts` — stores `Set<string>` of failed tile IDs. Pure `useReducer` dispatch, zero canvas store dependency.
3. In viewport tile rendering — failed tile IDs render a subtle "Could not load this section. [Retry]" message using strings from `workspaceStrings`.
4. Add `tileLoadError` + `tileLoadRetry` to workspaceStrings.ts.
5. Add `analyticsService.track('tile_load_failed', { tileId })` on exhausted retries (fire-and-forget with `.catch()`).
6. `src/features/workspace/services/__tests__/tileLoader.retry.test.ts`.
7. `npm run check` → green.

**Tech Debt Incurred & Resolved:**
- ✅ `TILE_FAILED` state lives in `tileReducer`, never bleeds into canvas store
- ✅ Analytics fire-and-forget with `.catch()` — no unhandled rejections

---

### Phase E: Accessibility Hardening (~6h)
**Goal:** Focus traps on all 9 dialogs, skip link, Lighthouse CI gate ≥ 90.

**Steps:**
1. `src/shared/hooks/useFocusTrap.ts` — returns `containerRef`. On mount: saves `previousFocus`, moves focus to first focusable child. Handles `Tab`/`Shift+Tab` cycle within container. On unmount: restores `previousFocus`. (< 75 lines)
2. `src/shared/hooks/__tests__/useFocusTrap.test.ts` — Tab cycling, Shift+Tab reverse, focus restore, empty container.
3. Apply `useFocusTrap` to all 9 `role="dialog"` components: `SettingsPanel`, `UpgradeWall`, `UpgradePrompt`, `ConfirmDialog`, `WelcomeScreen`, `CoachMark`, `ShortcutsPanel`, `PasteTextModal`, `ExportDialog`, `FocusOverlay`.
4. `src/shared/components/SkipLink.tsx` — visually hidden `<a>` (visible on `:focus`), links to `#main-canvas`. (< 30 lines)
5. `src/shared/localization/a11yStrings.ts` — `skipToMainContent`, `skipLinkLabel`. Import into `strings.ts` as `strings.a11y`.
6. Add `<SkipLink />` as first rendered child in `App.tsx`. Add `id="main-canvas"` to `CanvasView` wrapper.
7. `.github/workflows/lighthouse.yml` — runs on PR, enforces `accessibility >= 90` using `lhci/action@0.12.x`.
8. `npm run check` → green. Lighthouse local run → verify ≥ 90.

**Tech Debt Incurred & Resolved:**
- ✅ All 9 dialogs have focus trap + restore — keyboard users never get stuck
- ✅ Skip link uses CSS visually-hidden class, not `display:none` (VoiceOver/NVDA compatible)
- ✅ Lighthouse CI gate prevents a11y regressions from future PRs

---

### Verification Per Phase (Checklist)
Each phase ends with:
1. `npm run check` (typecheck + lint + test) → 0 errors, 0 warnings above threshold
2. `find src -name "*.ts*" | xargs wc -l | awk '$1 > 300'` → empty
3. `grep -r 'console\.' src/` → 0 results
4. `grep -r 'crypto\.randomUUID' src/` → 0 results (Phase A onward)
5. `grep -r 'useCanvasStore\|canvasStore' src/shared/` → 0 results (Phase C: confirm isolation)

---

### Relevant Files Summary

| Phase | New Files | Modified Files |
|-------|-----------|----------------|
| A | `idUtils.ts`, `idUtils.test.ts` | 15 src/ files, package.json |
| B | `firebaseUtils.retry.test.ts` | `firebaseUtils.ts`, `useSaveCallback.ts`, queue drainer |
| C | 10 new files (service, hook, context, component, strings, tests) | `App.tsx`, `useSaveCallback.ts`, `strings.ts` |
| D | `tileLoader.retry.test.ts` | `tileLoader.ts`, `tileReducer.ts`, `workspaceStrings.ts` |
| E | `useFocusTrap.ts`, `SkipLink.tsx`, `a11yStrings.ts`, `lighthouse.yml`, 4 test files | 9 dialog components, `App.tsx`, `strings.ts` |

---

**Decisions:**
- functions excluded from Phase A — Node 15+ runtime guarantees `crypto.randomUUID()`
- `withRetry` lives in `firebaseUtils.ts` (not a separate file) since the file stays well under 300 lines
- Tab leader uses `BroadcastChannel` + `localStorage` fallback — no extra npm dependencies
- Follower tabs **do not block UI editing**, only block Firestore writes — user can still work, just won't auto-save until they Take Over