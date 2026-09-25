# Warning Remediation Plan

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

**Date**: 2026-03-12
**Total Warnings**: 39 (0 errors)
**Target**: 0 warnings, 0 errors, full test coverage

---

## Warning Inventory

### Category 1: Non-null Assertions (`@typescript-eslint/no-non-null-assertion`) — 19 warnings

| # | File | Line(s) | Root Cause |
|---|------|---------|------------|
| 1 | `src/features/clustering/services/similarityService.ts` | 107, 107, 117, 117, 135, 136, 136, 136, 166, 168, 168, 169, 170 | Array index access on `clusters[]`, `simMatrix[]`, `vectors[]` without bounds check |
| 2 | `src/features/canvas/stores/historyReducer.ts` | 42, 51 | `stack[stack.length - 1]!` — last-element access |
| 3 | `src/features/canvas/hooks/useDragBatch.ts` | 58 | `frozenStart[0]!.id` — single-element array access |
| 4 | `src/features/onboarding/components/OnboardingWalkthrough.tsx` | 115 | `COACH_MARKS.find(...)!` — assumed match |
| 5 | `src/features/search/services/fuzzyMatch.ts` | 113 | `ranges[0]!` — first element access |
| 6 | `src/shared/components/Toast.tsx` | 24 | `t.action!.onClick()` inside `t.action &&` guard |

**Fix Strategy**: Replace `!` assertions with:
- `Array.at(-1)` or `.at(0)` with early-return guards
- Optional chaining `?.`
- Explicit `if` guards before access
- `?? fallback` default values

### Category 2: Max Lines Per Function (`max-lines-per-function`) — 10 warnings

| # | File | Function | Lines | Limit |
|---|------|----------|-------|-------|
| 1 | `src/features/search/components/SearchBar.tsx:50` | `SearchBar` | 137 | 80 |
| 2 | `src/features/search/hooks/useSearch.ts:42` | `useSearch` | 124 | 80 |
| 3 | `src/features/search/hooks/useSearch.ts:63` | results useMemo arrow | 90 | 80 |
| 4 | `src/features/canvas/components/FocusOverlay.tsx:28` | `FocusOverlay` | 99 | 80 |
| 5 | `src/features/canvas/components/edges/DeletableEdge.tsx:38` | `DeletableEdge` | 94 | 80 |
| 6 | `src/features/canvas/components/nodes/IdeaCard.tsx:26` | `IdeaCard` | 89 | 80 |
| 7 | `src/features/canvas/hooks/useHeadingEditor.ts:18` | `useHeadingEditor` | 88 | 80 |
| 8 | `src/features/search/components/SearchFilterBar.tsx:19` | `SearchFilterBar` | 87 | 80 |
| 9 | `src/features/canvas/hooks/useCanvasEdgeHandlers.ts:8` | `useCanvasEdgeHandlers` | 86 | 80 |
| 10 | `src/features/canvas/components/CanvasView.tsx:62` | `CanvasViewInner` | 82 | 80 |

**Fix Strategy**: Extract helper functions, sub-hooks, and sub-components:
- Move handler logic into dedicated helpers outside component scope
- Extract JSX sections into named sub-components
- Extract useMemo/useCallback bodies into standalone pure functions

### Category 3: Complexity (`complexity`) — 6 warnings

| # | File | Function | Complexity | Limit |
|---|------|----------|-----------|-------|
| 1 | `src/features/search/hooks/useSearch.ts:63` | results useMemo arrow | 27 | 20 |
| 2 | `src/features/canvas/components/FocusOverlay.tsx:28` | `FocusOverlay` | 27 | 20 |
| 3 | `src/app/hooks/useKeyboardShortcuts.ts:84` | `handleModifierShortcuts` | 23 | 20 |
| 4 | `src/features/canvas/components/nodes/IdeaCard.tsx:26` | `IdeaCard` | 22 | 20 |
| 5 | `src/features/canvas/components/nodes/NodeContextMenu.tsx:43` | `NodeContextMenu` | 22 | 20 |
| 6 | `src/features/canvas/components/nodes/IdeaCardContentSection.tsx:92` | arrow function | 21 | 20 |

**Fix Strategy**: Decompose conditional logic into:
- Extracted sub-components with own rendering logic
- Lookup-table patterns replacing `if/else` chains
- Separate hook functions for independent logic blocks

### Category 4: Miscellaneous — 4 warnings

| # | File | Rule | Root Cause |
|---|------|------|------------|
| 1 | `src/features/onboarding/utils/__tests__/seedDemoNodes.test.ts:45` | Unused eslint-disable directive | `@typescript-eslint/no-non-null-assertion` disable is unnecessary |
| 2 | `src/features/search/services/searchFilters.ts:33` | Unused eslint-disable directive | `@typescript-eslint/no-unnecessary-condition` disable is unnecessary |
| 3 | `src/features/search/services/searchFilters.ts:19` | `@typescript-eslint/strict-boolean-expressions` | Object value in conditional always truthy |
| 4 | `src/features/search/context/SearchInputRefContext.tsx:36` | `react-refresh/only-export-components` | File exports both component and non-component function |

**Fix Strategy**:
- Remove stale eslint-disable comments (auto-fixable via `--fix`)
- Fix conditional expression to use explicit boolean check
- Separate `useSearchInputRef` hook into its own file

---

## Phase Plan

### Phase 1: Quick Wins (4 warnings)

**Scope**: Miscellaneous warnings — trivial fixes, no architectural changes.

**Files**:
- `src/features/onboarding/utils/__tests__/seedDemoNodes.test.ts`
- `src/features/search/services/searchFilters.ts`
- `src/features/search/context/SearchInputRefContext.tsx`

**Changes**:
1. Remove unused `eslint-disable` directive in seedDemoNodes.test.ts (line 45)
2. Remove unused `eslint-disable` directive in searchFilters.ts (line 33)
3. Fix `strict-boolean-expressions` in searchFilters.ts — replace object-in-conditional with explicit length check
4. Move `useSearchInputRef` hook to separate file to satisfy react-refresh

**Tests**: Existing tests cover these files. Run to confirm no regressions.
**Tech Debt**: None expected.

### Phase 2: Non-null Assertions (19 warnings)

**Scope**: Replace all `!` (non-null assertion) operators with safe alternatives.

**Files**:
- `src/features/clustering/services/similarityService.ts` (13 warnings)
- `src/features/canvas/stores/historyReducer.ts` (2 warnings)
- `src/features/canvas/hooks/useDragBatch.ts` (1 warning)
- `src/features/onboarding/components/OnboardingWalkthrough.tsx` (1 warning)
- `src/features/search/services/fuzzyMatch.ts` (1 warning)
- `src/shared/components/Toast.tsx` (1 warning)

**Changes**:
1. **similarityService.ts**: Replace `clusters[i]!` patterns with guarded access or local variables with bounds checks
2. **historyReducer.ts**: Replace `stack[stack.length - 1]!` with `Array.at(-1)` + early return
3. **useDragBatch.ts**: Replace `frozenStart[0]!.id` with optional chaining `frozenStart[0]?.id`
4. **OnboardingWalkthrough.tsx**: Replace `COACH_MARKS.find(...)!` with guard clause
5. **fuzzyMatch.ts**: Replace `ranges[0]!` with `ranges[0]` + guard
6. **Toast.tsx**: Replace `t.action!.onClick()` with `t.action?.onClick()`

**Tests**: Write/verify unit tests for null/undefined edge cases in each function.
**Tech Debt**: None expected — pure safety improvements.

### Phase 3: Function Length + Complexity (16 warnings)

**Scope**: Refactor 12 files to reduce function length (≤80 lines) and complexity (≤20).

**Sub-phase 3a: Search module (5 warnings)**
- `useSearch.ts` → Extract `computeSearchResults()` pure function, extract `matchField()` helper
- `SearchBar.tsx` → Extract `useSearchBarKeyboard()` hook, `SearchResultsList` sub-component
- `SearchFilterBar.tsx` → Extract `DateRangeFilter` and `ContentTypeFilter` sub-components

**Sub-phase 3b: Canvas components (8 warnings)**
- `FocusOverlay.tsx` → Extract `FocusOverlayContent` sub-component
- `DeletableEdge.tsx` → Extract `useEdgeDelete()` hook
- `IdeaCard.tsx` → Extract conditional sections into helper functions
- `IdeaCardContentSection.tsx` → Extract `MindmapSection` sub-component
- `NodeContextMenu.tsx` → Extract menu section renderers
- `CanvasView.tsx` → Extract ReactFlow props builder
- `useCanvasEdgeHandlers.ts` → Extract edge removal undo command builder
- `useHeadingEditor.ts` → Extract extension builder + submit handler

**Sub-phase 3c: Keyboard shortcuts (1 warning)**
- `useKeyboardShortcuts.ts` → Extract modifier key handlers into lookup map

**Tests**: Structural tests for extracted functions. Integration tests for component behavior.
**Tech Debt**: None — extracting functions improves testability.

---

## Estimated Timeline

| Phase | Warnings Fixed | Cumulative |
|-------|---------------|------------|
| Phase 1 | 4 | 4 / 39 |
| Phase 2 | 19 | 23 / 39 |
| Phase 3 | 16 | 39 / 39 |

---

## Verification Checklist (per phase)

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx eslint .` — zero warnings, zero errors
- [ ] `npx vitest run` — all tests pass
- [ ] `npx vite build` — clean build
- [ ] No new tech debt introduced
- [ ] Security compliance verified
