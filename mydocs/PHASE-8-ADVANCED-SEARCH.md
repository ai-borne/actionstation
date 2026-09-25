# Phase 8: Advanced Search — Find Anything Instantly (AMENDED)

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

## Critical Issues Fixed from Original Plan

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 1 | **TF-IDF API mismatch** — plan's `findSimilar` assumed `tfidfScore` returns `Map<string, number>` (vector). Actual API returns `number` (scalar). `cosineSimilarity` over Map vectors has no data source. | CRITICAL | Add `buildTFIDFVector()` to `tfidfScorer.ts` (SSOT). `findSimilar` consumes vectors, not scalars. |
| 2 | **No `useReducer`** — plan used `useState` for query + filters. User requires clean one-shot `useReducer` dispatch, isolated from canvas store. | CRITICAL | New `searchReducer.ts` (pure function), `useSearch` consumes via `useReducer`. |
| 3 | **Fuzzy match consecutive bonus bug** — after `qi++`, `lq[qi - 1]` is current char, not previous. Bonus check is wrong. | BUG | Track `lastMatchIdx` variable instead. |
| 4 | **`highlightRanges.ts` too small** — 25 lines for one export. Violates "no premature abstraction." | DESIGN | Merge into `fuzzyMatch.ts` (~60 lines total, under 75). |
| 5 | **Dropped `prompt` backward compat** — existing search checks legacy `prompt` field. Plan only searches heading/output/tags. | REGRESSION | Maintain `prompt` fallback in `useSearch` (heading > prompt > output priority). |
| 6 | **No integration tests** — user explicitly requires integration tests per sub-phase. | MISSING | Each sub-phase includes integration test file. |
| 7 | **Security gaps** — no input sanitization, no XSS protection for highlight rendering, no query length limit. | SECURITY | React elements for highlights (no `dangerouslySetInnerHTML`), query length cap, tag validation via Zod. |
| 8 | **NodeContextMenu line count wrong** — plan says "stays under 100 lines." Already 148 lines. | INACCURATE | Extract "Find Similar" trigger to `useNodeContextActions` hook (separation of concerns). |
| 9 | **No debounce for TF-IDF** — `findSimilarNodes` is O(n²). Running on every keystroke is a performance hazard. | PERF | "Find Similar" is on-demand (button click), NOT keystroke-driven. Add `useMemo` guard. |

---

## Additional Gaps Identified in Codebase Review

Found by auditing actual source files (`useKeyboardShortcuts.ts`, `SearchBar.tsx`, `useSearch.ts`, `tfidfScorer.ts`) after the original plan was written:

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| G1 | **No ⌘+K global search hotkey** — `useKeyboardShortcuts.ts` has zero search binding. Users must click the topbar input. Fatal UX gap for a keyboard-first BASB app. | CRITICAL | New sub-phase **8A.0**: register `⌘+K` (Mac) / `Ctrl+K` (Win) in `useKeyboardShortcuts.ts`, auto-focus search input via `useImperativeHandle`. ~10 lines. |
| G2 | **No keyboard navigation of results** — `SearchBar.tsx` has zero arrow-key support. Users must reach for the mouse after typing. | HIGH | Add `SET_ACTIVE_INDEX` action to reducer; `ArrowDown/Up` navigates results; `Enter` selects. Covered in 8C + 8D. |
| G3 | **Main search path has no debounce** — `useMemo` recomputes on every `SET_QUERY` dispatch (every keystroke). Fuzzy match is O(n·m) per node. | HIGH | Use React 18's `useDeferredValue` on the query before the `useMemo` — keeps input responsive, defers expensive computation. Zero external deps. Covered in 8C. |
| G4 | **Fuzzy scoring ignores field weight in composite** — plan describes heading > output priority but the score formula doesn't multiply `fuzzyScore × fieldWeight`. Static fallback to 0.8 not enough for fuzzy path. | MEDIUM | Composite scoring: `finalScore = fuzzyScore × fieldWeight × recencyBoost`. Covered in 8C. |
| G5 | **`findSimilarNodes` rebuilds IDF every call** — tokenizes all N nodes + computes full IDF each invocation. No caching. Repeated calls are O(n²). | HIGH | Accept optional pre-computed `idfCache` param; `useFindSimilar` memoizes corpus+IDF keyed on `nodes`. Covered in 8E. |
| G6 | **No result pagination** — filter-only mode with broad content-type filters can surface hundreds of results in a flat list. | MEDIUM | Cap visible results at 20 in `useMemo`, add "Show N more" in `SearchBar`. Covered in 8C + 8D. |
| G7 | **`splitByRanges` assumes sorted, non-overlapping input** — if `fuzzyMatch` ever returns overlapping ranges (a bug), output is garbled. No defensive guard. | LOW | Sort + merge ranges at entry before processing. Covered in 8B. |
| G8 | **No result snippets** — matches buried deep in `output` field show the full string, not a windowed context excerpt. | MEDIUM | Add `extractSnippet(text, ranges, contextChars=40)` utility to `fuzzyMatch.ts`. Covered in 8B. |
| G9 | **No `isComputing` state in `useFindSimilar`** — TF-IDF over 500 nodes can take 100ms+. No loading state means a frozen UI with no feedback. | MEDIUM | Derive `isComputing` from `useDeferredValue` (no `setState` side-effect anti-pattern). Covered in 8E. |
| G10 | **Test count wrong in backward-compat claim** — plan says "existing 11 tests" but actual count is **12** unit + 2 interface + 2 null-safety + 3 integration = **19 total**. | LOW | Fix to "existing 12 unit tests" throughout. Covered in 8C. |

---

## Problem Statement

Current search (`useSearch.ts`, 105 lines) does case-insensitive substring matching on `heading` and `output` fields only. As users accumulate hundreds of nodes, this breaks down:

- **No tag filtering** — users tag nodes but can't search by tag
- **No fuzzy matching** — "brainstrom" won't find "brainstorm"
- **No content-type filtering** — can't search "only nodes with AI output"
- **No date filtering** — can't find "what I worked on last week"
- **No semantic similarity** — TF-IDF scorer exists (`tfidfScorer.ts`, 74 lines) but isn't used
- **Results lack context** — no snippet highlighting

## Architecture Decisions (Amended)

### State Management: `useReducer` (NOT Zustand)

Search state is **transient UI state** — no persistence, no cross-component sharing. `useReducer` provides:
- **One-shot atomic updates** — no cascading `setState` calls
- **Testable reducer** — pure function, zero React dependency
- **Complete isolation** from canvas store (canvas data read via selectors, search state in local reducer)

```
Dispatch chain:
  User types → dispatch({ type: 'SET_QUERY' }) → reducer → new state
  → useMemo recomputes results from (nodes × filters × query)
  → React renders once

NO intermediate renders. NO cascade. NO stale closures.
```

### Zustand Read-Only Pattern

Canvas data is read via selectors — **never mutated** by search:
```typescript
const nodes = useCanvasStore((s) => s.nodes);     // selector: re-render only on nodes change
const edges = useCanvasStore((s) => s.edges);      // selector: re-render only on edges change
```
No `useStore()` destructuring. No closure variables in selectors.

### Security Contract

- **No `dangerouslySetInnerHTML`** — highlights rendered via React elements (`splitByRanges` → `<mark>`)
- **Query length cap** — max 200 characters (prevents memory abuse)
- **Tag validation** — reuses Zod `tagNameSchema` from `schemas.ts`
- **No regex from user input** — fuzzy match uses character comparison, never `new RegExp(userInput)`
- **Date validation** — `isNaN(date.getTime())` guard on filter inputs

### DRY / SSOT

- Tokenization: reuse `tokenizeRaw()` from `relevanceScorer.ts` (SSOT for tokenization)
- TF-IDF vectors: add `buildTFIDFVector()` to `tfidfScorer.ts` (SSOT for TF-IDF math)
- Cosine similarity: pure function in `findSimilar.ts` (search-specific)
- Strings: new `searchStrings.ts` file imported into `strings.ts` (follows feature-first pattern)

---

## Sub-phase 8A.0: ⌘+K Global Search Hotkey

### What We Build

Register a global keyboard shortcut to invoke search — the single highest-leverage UX improvement for a keyboard-first BASB app. Currently `useKeyboardShortcuts.ts` has no search binding at all.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/app/hooks/useKeyboardShortcuts.ts` | EDIT | +10 lines |
| `src/features/search/components/SearchBar.tsx` | EDIT | Add `useImperativeHandle` focus ref |

### Implementation

```typescript
// In useKeyboardShortcuts.ts — alongside existing ⌘+N handler:
useEffect(() => {
    const handler = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            // Don't fire when user is already typing in a node editor
            if (e.target instanceof HTMLElement && e.target.closest('[data-node-editor]')) return;
            e.preventDefault();
            searchInputRef.current?.focus();
            searchInputRef.current?.select();
        }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
}, [searchInputRef]);
```

`SearchBar` exposes its `<input>` focus via `useImperativeHandle` and a `SearchInputRefContext` created at the app level — no prop drilling, no store mutation.

### TDD Tests

```
1. ⌘+K focuses the search input (ref.focus() called)
2. Ctrl+K focuses the search input (Windows compat)
3. ⌘+K is suppressed when focus is inside a node editor ([data-node-editor])
4. ⌘+K selects existing text in the search input (ref.select() called)
```

### Tech Debt Checkpoint

- [ ] Shortcut registered alongside existing `⌘+N` handler pattern
- [ ] `SearchBar` exposes `focus()` + `select()` via `useImperativeHandle` (no prop drilling)
- [ ] Shortcut suppressed when a node text-editor is active (conflict prevention)
- [ ] Zero lint errors

---

## Sub-phase 8A: Search Filter Types & Predicates

### What We Build

Type definitions for filters, composable predicate functions, and input validation.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/search/types/search.ts` | EDIT | ~45 (from 13) |
| `src/features/search/services/searchFilters.ts` | NEW | ~55 |
| `src/features/search/services/__tests__/searchFilters.test.ts` | NEW | ~90 |
| `src/features/search/__tests__/searchFilters.integration.test.ts` | NEW | ~50 |

### Implementation

**Extended `search.ts`** (~45 lines):

```typescript
export interface SearchResult {
    nodeId: string;
    workspaceId: string;
    workspaceName: string;
    matchedContent: string;
    matchType: 'heading' | 'prompt' | 'output' | 'tag';
    relevance: number;
    highlightRanges: ReadonlyArray<{ start: number; end: number }>;
}

export interface SearchFilters {
    tags?: string[];
    dateRange?: { from: Date | null; to: Date | null };
    contentType?: ContentTypeFilter;
    workspaceId?: string;
}

export type ContentTypeFilter =
    | 'all'
    | 'hasOutput'
    | 'hasAttachments'
    | 'hasConnections'
    | 'noOutput';

/** Type guard: at least one filter is active */
export function hasActiveFilters(f: SearchFilters): boolean {
    return Boolean(
        f.tags?.length || f.dateRange?.from || f.dateRange?.to
        || (f.contentType && f.contentType !== 'all') || f.workspaceId
    );
}
```

**`searchFilters.ts`** (~55 lines) — pure predicate functions:

```typescript
export function matchesTags(node: CanvasNode, tags: string[]): boolean {
    const nodeTags = node.data?.tags ?? [];
    return tags.some((tag) => nodeTags.includes(tag));
}

export function matchesDateRange(node: CanvasNode, from: Date | null, to: Date | null): boolean {
    const updated = node.updatedAt ?? node.createdAt;
    if (!updated) return true;
    const time = updated instanceof Date ? updated.getTime() : new Date(updated).getTime();
    if (isNaN(time)) return true; // Security: invalid dates don't crash
    if (from && !isNaN(from.getTime()) && time < from.getTime()) return false;
    if (to && !isNaN(to.getTime()) && time > to.getTime()) return false;
    return true;
}

export function matchesContentType(
    node: CanvasNode, filter: ContentTypeFilter, edges: CanvasEdge[]
): boolean {
    if (filter === 'all') return true;
    if (filter === 'hasOutput') return Boolean(node.data?.output?.trim());
    if (filter === 'hasAttachments') return (node.data?.attachments?.length ?? 0) > 0;
    if (filter === 'noOutput') return !node.data?.output?.trim();
    if (filter === 'hasConnections') {
        return edges.some((e) => e.source === node.id || e.target === node.id);
    }
    return true;
}

export function applyFilters(
    nodes: CanvasNode[], edges: CanvasEdge[], filters: SearchFilters
): CanvasNode[] {
    return nodes.filter((node) => {
        if (filters.tags?.length && !matchesTags(node, filters.tags)) return false;
        if (filters.dateRange && !matchesDateRange(node, filters.dateRange.from, filters.dateRange.to)) return false;
        if (filters.contentType && !matchesContentType(node, filters.contentType, edges)) return false;
        if (filters.workspaceId && node.workspaceId !== filters.workspaceId) return false;
        return true;
    });
}
```

### TDD Tests

**Unit tests** (`searchFilters.test.ts`, ~90 lines):
```
1. matchesTags returns true when node has any matching tag
2. matchesTags returns false when no tags match
3. matchesTags handles undefined tags gracefully
4. matchesDateRange includes nodes within range
5. matchesDateRange excludes nodes outside range
6. matchesDateRange handles null from/to (open-ended)
7. matchesDateRange handles invalid Date (NaN) — security test
8. matchesContentType 'hasOutput' filters correctly
9. matchesContentType 'hasAttachments' filters correctly
10. matchesContentType 'hasConnections' checks edges
11. matchesContentType 'noOutput' returns nodes without AI output
12. applyFilters composes all predicates (AND logic)
13. applyFilters with no filters returns all nodes
14. applyFilters with workspace scope limits results
```

**Integration test** (`searchFilters.integration.test.ts`, ~50 lines):
```
1. applyFilters with real CanvasNode shapes from canvas store
2. Filter composition: tag + date + contentType all applied
3. Edge case: empty node array
```

### Tech Debt Checkpoint

- [ ] `searchFilters.ts` under 60 lines
- [ ] Pure functions, no side effects, no imports of React/stores
- [ ] Date validation guards NaN (security)
- [ ] Zero lint errors
- [ ] All 14 unit + 3 integration tests pass
- [ ] `npm run build` succeeds

---

## Sub-phase 8B: Fuzzy Match & Highlight (Consolidated)

### What We Build

Fuzzy matcher + highlight segmenter in **one file** (eliminates premature `highlightRanges.ts` abstraction).

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/search/services/fuzzyMatch.ts` | NEW | ~80 |
| `src/features/search/services/__tests__/fuzzyMatch.test.ts` | NEW | ~125 |

### Implementation

**`fuzzyMatch.ts`** (~60 lines) — fixed consecutive bonus bug + highlight segments:

```typescript
export interface FuzzyResult {
    matches: boolean;
    score: number;
    ranges: ReadonlyArray<{ start: number; end: number }>;
}

export interface TextSegment {
    text: string;
    highlighted: boolean;
}

const MAX_QUERY_LENGTH = 200; // Security: prevent excessive computation

export function fuzzyMatch(query: string, text: string): FuzzyResult {
    if (!query || !text || query.length > MAX_QUERY_LENGTH) {
        return { matches: false, score: 0, ranges: [] };
    }
    const lq = query.toLowerCase();
    const lt = text.toLowerCase();

    // Exact substring = highest score
    const exactIdx = lt.indexOf(lq);
    if (exactIdx !== -1) {
        return { matches: true, score: 1.0, ranges: [{ start: exactIdx, end: exactIdx + lq.length }] };
    }

    // Subsequence match with consecutive bonus (FIXED: track lastMatchIdx)
    let qi = 0;
    let score = 0;
    let lastMatchIdx = -2; // -2 so first match can't be "consecutive"
    const ranges: Array<{ start: number; end: number }> = [];
    let rangeStart = -1;

    for (let ti = 0; ti < lt.length && qi < lq.length; ti++) {
        if (lt[ti] === lq[qi]) {
            if (rangeStart === -1) rangeStart = ti;
            score += 1;
            if (ti === lastMatchIdx + 1) score += 0.5; // consecutive bonus
            lastMatchIdx = ti;
            qi++;
        } else if (rangeStart !== -1) {
            ranges.push({ start: rangeStart, end: ti });
            rangeStart = -1;
        }
    }
    if (rangeStart !== -1 && qi > 0) {
        ranges.push({ start: rangeStart, end: lastMatchIdx + 1 });
    }

    const matched = qi === lq.length;
    return {
        matches: matched,
        score: matched ? Math.min(score / (lq.length * 1.5), 0.99) : 0, // cap below 1.0 (exact only = 1.0)
        ranges: matched ? ranges : [],
    };
}

/**
 * Split text into highlighted/non-highlighted segments for safe React rendering.
 * Defensively sorts and merges overlapping ranges before processing.
 */
export function splitByRanges(
    text: string, ranges: ReadonlyArray<{ start: number; end: number }>
): TextSegment[] {
    if (ranges.length === 0) return [{ text, highlighted: false }];
    // Defensive: sort and merge overlapping ranges (guards against upstream bugs)
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [];
    for (const r of sorted) {
        const prev = merged[merged.length - 1];
        if (prev && r.start <= prev.end) { prev.end = Math.max(prev.end, r.end); }
        else merged.push({ ...r });
    }
    const segments: TextSegment[] = [];
    let cursor = 0;
    for (const { start, end } of merged) {
        if (start > cursor) segments.push({ text: text.slice(cursor, start), highlighted: false });
        segments.push({ text: text.slice(start, end), highlighted: true });
        cursor = end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
    return segments;
}

const SNIPPET_CONTEXT_CHARS = 40;

/** Extract a windowed snippet around the first match range for compact result display. */
export function extractSnippet(
    text: string,
    ranges: ReadonlyArray<{ start: number; end: number }>,
    contextChars = SNIPPET_CONTEXT_CHARS
): string {
    if (ranges.length === 0 || text.length <= contextChars * 2) return text;
    const first = ranges[0]!;
    const windowStart = Math.max(0, first.start - contextChars);
    const windowEnd = Math.min(text.length, first.end + contextChars);
    const prefix = windowStart > 0 ? '…' : '';
    const suffix = windowEnd < text.length ? '…' : '';
    return prefix + text.slice(windowStart, windowEnd) + suffix;
}
```

### TDD Tests (~125 lines)

```
1. Exact match returns score 1.0
2. Subsequence match returns score < 1.0
3. No match returns { matches: false }
4. Case insensitive matching
5. Consecutive characters get bonus (higher score than scattered)
6. Empty query returns no match
7. Query exceeding MAX_QUERY_LENGTH returns no match (security)
8. "brainstrom" fuzzy-matches "brainstorm"
9. splitByRanges produces correct segments for single range
10. splitByRanges handles no ranges (full text, not highlighted)
11. splitByRanges handles multiple ranges
12. splitByRanges handles adjacent ranges
13. splitByRanges handles range at start of text
14. splitByRanges handles range at end of text
15. splitByRanges defensively sorts unsorted input ranges
16. splitByRanges merges overlapping ranges into one highlight
17. extractSnippet returns windowed context around first match (±40 chars)
18. extractSnippet prefixes/suffixes '…' when text is truncated
19. extractSnippet returns full text when shorter than 2×contextChars
20. extractSnippet handles match at start (no leading '…')
21. extractSnippet handles match at end (no trailing '…')
```

### Tech Debt Checkpoint

- [ ] `fuzzyMatch.ts` under 85 lines (three exports: `fuzzyMatch`, `splitByRanges`, `extractSnippet`)
- [ ] `splitByRanges` defensively sorts and merges overlapping input ranges
- [ ] Pure functions, zero dependencies
- [ ] MAX_QUERY_LENGTH enforced (security)
- [ ] Score capped at 0.99 for fuzzy (1.0 reserved for exact match)
- [ ] Zero lint errors
- [ ] All 21 tests pass

---

## Sub-phase 8C: Search Reducer & Enhanced useSearch

### What We Build

A pure `searchReducer` function and an upgraded `useSearch` hook that composes 8A + 8B via `useReducer`.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/search/hooks/searchReducer.ts` | NEW | ~55 |
| `src/features/search/hooks/__tests__/searchReducer.test.ts` | NEW | ~65 |
| `src/features/search/hooks/useSearch.ts` | REWRITE | ~90 |
| `src/features/search/__tests__/useSearch.test.ts` | EXTEND | ~320 (from 256) |
| `src/features/search/__tests__/useSearch.integration.test.ts` | NEW | ~60 |

### Implementation

**`searchReducer.ts`** (~55 lines) — pure function, completely isolated:

```typescript
import type { SearchFilters } from '../types/search';

export interface SearchState {
    query: string;
    filters: SearchFilters;
    activeIndex: number;        // Keyboard navigation: -1 = none selected
    isFilterBarOpen: boolean;   // Filter panel toggle state
}

export type SearchAction =
    | { type: 'SET_QUERY'; query: string }
    | { type: 'SET_FILTER'; filter: Partial<SearchFilters> }
    | { type: 'SET_ACTIVE_INDEX'; index: number }
    | { type: 'TOGGLE_FILTER_BAR' }
    | { type: 'CLEAR_FILTERS' }
    | { type: 'CLEAR_ALL' };

export const INITIAL_SEARCH_STATE: SearchState = {
    query: '',
    filters: {},
    activeIndex: -1,
    isFilterBarOpen: false,
};

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
    switch (action.type) {
        case 'SET_QUERY':
            // Reset activeIndex so stale keyboard selection doesn't persist
            return { ...state, query: action.query.slice(0, 200), activeIndex: -1 };
        case 'SET_FILTER':
            return { ...state, filters: { ...state.filters, ...action.filter } };
        case 'SET_ACTIVE_INDEX':
            return { ...state, activeIndex: action.index };
        case 'TOGGLE_FILTER_BAR':
            return { ...state, isFilterBarOpen: !state.isFilterBarOpen };
        case 'CLEAR_FILTERS':
            return { ...state, filters: {} };
        case 'CLEAR_ALL':
            return INITIAL_SEARCH_STATE;
    }
}
```

**Upgraded `useSearch.ts`** (~90 lines):

```typescript
// Field weights for composite scoring: heading > prompt (legacy) > output > tag
const FIELD_WEIGHTS = { heading: 1.0, prompt: 1.0, output: 0.8, tag: 0.6 } as const;

// Mild recency boost: rewards recently updated nodes without overwhelming relevance
function recencyBoost(node: CanvasNode): number {
    const ts = node.updatedAt ?? node.createdAt;
    if (!ts) return 0.90;
    const age = Date.now() - new Date(ts).getTime();
    if (age < 7 * 86_400_000)  return 1.00; // last 7 days
    if (age < 30 * 86_400_000) return 0.95; // last 30 days
    return 0.90;
}

export function useSearch(): UseSearchReturn {
    const [state, dispatch] = useReducer(searchReducer, INITIAL_SEARCH_STATE);

    // Read-only selectors — NO store mutations from search
    const nodes = useCanvasStore((s) => s.nodes);
    const edges = useCanvasStore((s) => s.edges);
    const workspaces = useWorkspaceStore((s) => s.workspaces);

    // useDeferredValue defers the expensive O(n·m) fuzzy computation while keeping
    // the input field responsive on every keystroke (React 18, zero external deps).
    const deferredQuery = useDeferredValue(state.query);

    const workspaceMap = useMemo(() => {
        const map = new Map<string, string>();
        workspaces.forEach((ws) => {
            if (ws.type !== 'divider') map.set(ws.id, ws.name);
        });
        return map;
    }, [workspaces]);

    const results = useMemo((): SearchResult[] => {
        const { filters } = state;
        const query = deferredQuery; // deferred — input stays snappy
        const filtered = applyFilters(nodes, edges, filters);

        if (!query.trim()) {
            if (hasActiveFilters(filters)) {
                return filtered.map((node) => ({
                    nodeId: node.id, workspaceId: node.workspaceId,
                    workspaceName: workspaceMap.get(node.workspaceId) ?? '',
                    matchedContent: node.data?.heading ?? '',
                    matchType: 'heading' as const, relevance: 1.0, highlightRanges: [],
                }));
            }
            return [];
        }

        // Composite scoring: fuzzyScore × fieldWeight × recencyBoost
        // Priority: heading > prompt (legacy, backward compat) > output > tags
        const searchResults: SearchResult[] = [];
        for (const node of filtered) {
            const boost = recencyBoost(node);
            // heading match (fieldWeight=1.0), prompt fallback (fieldWeight=1.0),
            // output match (fieldWeight=0.8), tag match (fieldWeight=0.6)
            // Each: finalRelevance = fuzzyResult.score * FIELD_WEIGHTS[field] * boost
            // matchedContent = extractSnippet(fieldText, fuzzyResult.ranges)
        }
        return searchResults
            .sort((a, b) => b.relevance - a.relevance)
            .slice(0, 20); // Pagination: cap at 20; SearchBar renders "Show N more"
    }, [state.filters, deferredQuery, nodes, edges, workspaceMap]);

    const search = useCallback((q: string) => dispatch({ type: 'SET_QUERY', query: q }), []);
    const setFilters = useCallback((f: Partial<SearchFilters>) => dispatch({ type: 'SET_FILTER', filter: f }), []);
    const clearFilters = useCallback(() => dispatch({ type: 'CLEAR_FILTERS' }), []);
    const clear = useCallback(() => dispatch({ type: 'CLEAR_ALL' }), []);
    const toggleFilterBar = useCallback(() => dispatch({ type: 'TOGGLE_FILTER_BAR' }), []);
    const setActiveIndex = useCallback((i: number) => dispatch({ type: 'SET_ACTIVE_INDEX', index: i }), []);

    return {
        query: state.query, filters: state.filters,
        activeIndex: state.activeIndex, isFilterBarOpen: state.isFilterBarOpen,
        results, search, setFilters, clearFilters, clear, toggleFilterBar, setActiveIndex,
    };
}
```

**Key design decisions:**
- `useReducer` is one-shot: every dispatch → single state transition → single `useMemo` recompute
- Canvas store read via selectors (re-render only when nodes/edges/workspaces change)
- No `useEffect` in the hook — derived state via `useMemo` only (no stale closures)
- Backward compatible: `search(query)` and `clear()` still work for existing consumers

### TDD Tests

**Reducer unit tests** (`searchReducer.test.ts`, ~65 lines):
```
1. SET_QUERY updates query
2. SET_QUERY caps at 200 chars (security)
3. SET_QUERY resets activeIndex to -1 (stale selection cleared)
4. SET_FILTER merges partial filter
5. SET_FILTER preserves existing filters
6. SET_ACTIVE_INDEX sets activeIndex
7. TOGGLE_FILTER_BAR flips isFilterBarOpen
8. TOGGLE_FILTER_BAR called twice returns to false
9. CLEAR_FILTERS resets filters but keeps query, activeIndex, isFilterBarOpen
10. CLEAR_ALL resets to INITIAL_SEARCH_STATE
11. Reducer returns same reference for unknown action type
```

**Extended useSearch tests** (add to existing, ~320 lines total):
```
Existing 12 unit tests: PRESERVED (backward compatibility)
12. Empty query + tag filter = all nodes with that tag
13. Query matches heading with fuzzy matching ("brainstrom" → "brainstorm")
14. Query matches tags
15. Tag filter narrows results
16. Date range filter narrows results
17. Content type 'hasOutput' filter narrows results
18. Workspace scope filter narrows results
19. Results include highlightRanges
20. Filters compose (tag + date = AND)
21. Results sorted by relevance (heading > prompt > output > tag)
22. clearFilters resets filters but keeps query
23. Legacy prompt fallback still works (backward compat)
```

**Integration test** (`useSearch.integration.test.ts`, ~60 lines):
```
1. Full flow: type query → get fuzzy results → apply filter → results narrow
2. Clear all resets everything
3. Filter-only mode (no query) returns all matching nodes
```

### Tech Debt Checkpoint

- [ ] `searchReducer.ts` under 60 lines, pure function
- [ ] `useSearch.ts` under 95 lines
- [ ] `useDeferredValue` wraps query before `useMemo` — input stays responsive
- [ ] `useMemo` dependency array uses `deferredQuery`, not `state.query` directly
- [ ] Composite scoring: `fuzzyScore × fieldWeight × recencyBoost` applied per field
- [ ] Results capped at 20 in `useMemo` (pagination foundation)
- [ ] `useSearch` return type includes `activeIndex`, `isFilterBarOpen`, `toggleFilterBar`, `setActiveIndex`
- [ ] Zero `useEffect` in `useSearch` — all derived via `useMemo`
- [ ] No Zustand anti-patterns (selectors only, no destructuring)
- [ ] No closure variables in selectors
- [ ] Existing 12 unit tests still pass (backward compat)
- [ ] Zero lint errors

---

## Sub-phase 8D: Filter Bar UI & String Resources

### What We Build

Filter bar component, search string resources, and SearchBar enhancement with highlight rendering.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/search/strings/searchStrings.ts` | NEW | ~45 |
| `src/shared/localization/strings.ts` | EDIT | Import searchStrings, replace inline search object |
| `src/features/search/components/TagFilterChips.tsx` | NEW | ~40 |
| `src/features/search/components/SearchFilterBar.tsx` | NEW | ~65 |
| `src/features/search/components/SearchFilterBar.module.css` | NEW | ~75 |
| `src/features/search/components/SearchBar.tsx` | EDIT | Keyboard nav + filter bar + highlight rendering |
| `src/features/search/components/SearchBar.module.css` | EDIT | Add highlight + filter + active-result styles |
| `src/features/search/components/__tests__/TagFilterChips.test.tsx` | NEW | ~40 |
| `src/features/search/components/__tests__/SearchFilterBar.test.tsx` | NEW | ~65 |
| `src/features/search/__tests__/searchUI.integration.test.tsx` | NEW | ~75 |

### Implementation

**`searchStrings.ts`** (~30 lines):

```typescript
export const searchStrings = {
    placeholder: 'Search notes...',
    noResults: 'No results found',
    resultsCount: 'results',
    inWorkspace: 'in',
    prompt: 'Prompt',
    heading: 'Heading',
    output: 'Output',
    tag: 'Tag',
    // Filter bar
    filterToggle: 'Toggle filters',
    filterClear: 'Clear all filters',
    filterTags: 'Tags',
    filterDateRange: 'Date range',
    filterDateFrom: 'From',
    filterDateTo: 'To',
    filterContentType: 'Content type',
    contentTypeAll: 'All',
    contentTypeHasOutput: 'Has AI output',
    contentTypeHasAttachments: 'Has attachments',
    contentTypeHasConnections: 'Has connections',
    contentTypeNoOutput: 'Empty nodes',
    activeFilters: 'active filters',
    findSimilar: 'Find similar',
    similarResults: 'Similar nodes',
    noSimilarResults: 'No similar nodes found',
    // Empty / idle state
    emptyStateTitle: 'Search your second brain',
    emptyStateHint: '⌘K to open, or type below',
    showMore: 'Show {n} more results',
    keyboardHint: '↑↓ navigate · ↵ select · Esc close',
} as const;
```

**`TagFilterChips.tsx`** (~40 lines) — extracted sub-component for multi-select tag filtering:
- Receives `availableTags`, `selectedTags`, `onToggle` as props (no direct store access)
- Renders chips as `<button role="checkbox" aria-checked>` (WCAG 2.1 AA)
- Isolated: independently testable, single responsibility

**`SearchFilterBar.tsx`** (~65 lines) — horizontal bar, composes `TagFilterChips`:
- **Tag chips**: delegates to `<TagFilterChips>` (available tags computed via `useMemo` over all nodes)
- **Date range**: Native `<input type="date">` (no external dependency)
- **Content type**: `<select aria-label>` dropdown
- **Active filter badge**: Shows count of active filters
- **Clear all button**: dispatches `CLEAR_FILTERS`
- Visibility gated by `isFilterBarOpen` from reducer (no local `useState`)

**`SearchBar.tsx` keyboard navigation** (added to existing component):

```typescript
const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') dispatch({ type: 'SET_ACTIVE_INDEX', index: Math.min(activeIndex + 1, results.length - 1) });
    if (e.key === 'ArrowUp')   dispatch({ type: 'SET_ACTIVE_INDEX', index: Math.max(activeIndex - 1, -1) });
    if (e.key === 'Enter' && activeIndex >= 0) { onResultClick(results[activeIndex]!); clear(); }
    if (e.key === 'Escape') { clear(); inputRef.current?.blur(); }
};
```

ARIA: `role="combobox"` on input, `aria-expanded`, `aria-haspopup="listbox"`, `aria-activedescendant` on input; `role="listbox"` on results `<ul>`; `role="option"` + `aria-selected` on each `<li>`.

**SearchBar highlight rendering** — safe React elements, NO `dangerouslySetInnerHTML`:

```typescript
function HighlightedText({ text, ranges }: { text: string; ranges: ... }) {
    const segments = splitByRanges(text, ranges);
    return (
        <>
            {segments.map((seg, i) =>
                seg.highlighted ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>
            )}
        </>
    );
}
```

### TDD Tests

**`TagFilterChips` tests** (`TagFilterChips.test.tsx`, ~40 lines):
```
1. Renders one chip per availableTag
2. Selected chips have aria-checked="true"
3. Clicking a chip calls onToggle with correct tag
4. Clicking a selected chip calls onToggle again (deselect)
5. Empty availableTags renders nothing (no crash)
```

**SearchFilterBar tests** (`SearchFilterBar.test.tsx`, ~65 lines):
```
1. Renders when isFilterBarOpen=true; hidden when false
2. Setting date range dispatches SET_FILTER + dateRange
3. Content type dropdown dispatches SET_FILTER + contentType
4. Active filter count badge shows correct number
5. Clear all button dispatches CLEAR_FILTERS
6. All labels sourced from searchStrings (no hardcoded text)
7. Invalid date input is ignored (NaN guard)
8. Delegates tag rendering to TagFilterChips
```

**SearchBar keyboard navigation tests** (add to existing `SearchBar.test.tsx`):
```
1. ArrowDown increments activeIndex
2. ArrowUp decrements activeIndex (clamps at -1)
3. Enter with activeIndex ≥ 0 calls onResultClick and clears search
4. Escape blurs the input and dispatches CLEAR_ALL
5. Input has role="combobox" and aria-expanded
6. Active result item has aria-selected="true"
7. ⌘K hint visible in empty state (from searchStrings.emptyStateHint)
```

**Integration test** (`searchUI.integration.test.tsx`, ~60 lines):
```
1. SearchBar + FilterBar: typing query shows fuzzy results with highlights
2. Toggling filter bar and applying tag filter narrows results
3. Clearing all resets search and filters
```

### Tech Debt Checkpoint

- [ ] `TagFilterChips.tsx` under 45 lines, no direct store access
- [ ] `SearchFilterBar.tsx` under 70 lines (composed via `TagFilterChips`)
- [ ] `SearchFilterBar.module.css` ~75 lines (chips, date, dropdown, badge, responsive)
- [ ] `SearchBar.tsx` under 135 lines after keyboard nav + filter integration
- [ ] `SearchBar` has `role="combobox"`, `aria-expanded`, `aria-haspopup="listbox"`, `aria-activedescendant` (WCAG 2.1 AA)
- [ ] Results `<ul>` has `role="listbox"`; each `<li>` has `role="option"` + `aria-selected`
- [ ] `TagFilterChips` uses `role="checkbox"` + `aria-checked` per chip
- [ ] `isFilterBarOpen` sourced from reducer state (no local `useState` for toggle)
- [ ] `activeIndex` sourced from reducer state (no local `useState` for navigation)
- [ ] ALL strings from `searchStrings` (zero hardcoded text, including empty-state hint)
- [ ] ALL CSS uses `var(--color-*)` / `var(--space-*)` / `var(--radius-*)` variables
- [ ] No `dangerouslySetInnerHTML` — safe React elements for highlights
- [ ] Native date inputs (no external date picker dependency)
- [ ] Inline `search: { ... }` in `strings.ts` replaced with `search: searchStrings`
- [ ] Zero lint errors

---

## Sub-phase 8E: "Find Similar" Semantic Search

### What We Build

TF-IDF cosine similarity for node-to-node semantic search. Triggered from context menu or search UI button.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/knowledgeBank/services/tfidfScorer.ts` | EDIT | Add `buildTFIDFVector` (~12 lines) |
| `src/features/search/services/findSimilar.ts` | NEW | ~55 |
| `src/features/search/services/__tests__/findSimilar.test.ts` | NEW | ~80 |
| `src/features/search/hooks/useFindSimilar.ts` | NEW | ~50 |
| `src/features/search/hooks/__tests__/useFindSimilar.test.ts` | NEW | ~55 |
| `src/features/canvas/components/nodes/NodeContextMenu.tsx` | EDIT | Add "Find Similar" menu item (~3 lines) |

### Implementation

**SSOT: `buildTFIDFVector` added to `tfidfScorer.ts`** (~12 new lines):

```typescript
/**
 * Build a TF-IDF vector for a document against a corpus IDF map.
 * Returns Map<term, tf*idf> for cosine similarity computation.
 */
export function buildTFIDFVector(
    tokens: readonly string[],
    idfMap: ReadonlyMap<string, number>
): Map<string, number> {
    const vec = new Map<string, number>();
    const unique = new Set(tokens);
    for (const term of unique) {
        const tf = computeTF(tokens, term);
        const idf = idfMap.get(term) ?? 0;
        if (tf > 0 && idf > 0) vec.set(term, tf * idf);
    }
    return vec;
}
```

This keeps `tfidfScorer.ts` at ~87 lines (under 100). SSOT: all TF-IDF math lives here.

**`findSimilar.ts`** (~55 lines) — uses SSOT imports:

```typescript
import { buildCorpusIDF, buildTFIDFVector } from '@/features/knowledgeBank/services/tfidfScorer';
import { tokenizeRaw } from '@/features/knowledgeBank/services/relevanceScorer';
import type { CanvasNode } from '@/features/canvas/types/node';

export interface SimilarResult {
    nodeId: string;
    similarity: number;
    heading: string;
}

const SIMILARITY_THRESHOLD = 0.15; // 0.1 surfaces too many loosely-related nodes; 0.15 is the practical floor

export function findSimilarNodes(
    sourceNodeId: string,
    nodes: CanvasNode[],
    topN = 7,
    precomputedIDF?: ReadonlyMap<string, number>, // Cache — avoids rebuilding IDF per call
): SimilarResult[] {
    const sourceNode = nodes.find((n) => n.id === sourceNodeId);
    if (!sourceNode) return [];

    const sourceText = getNodeText(sourceNode);
    if (!sourceText.trim()) return [];

    // Build tokenized corpus (reuses SSOT tokenizeRaw)
    const corpus = nodes.map((n) => tokenizeRaw(getNodeText(n)));
    const idf = precomputedIDF ?? buildCorpusIDF(corpus); // Use cache when provided

    const sourceIdx = nodes.findIndex((n) => n.id === sourceNodeId);
    const sourceVec = buildTFIDFVector(corpus[sourceIdx] ?? [], idf);

    const results: SimilarResult[] = [];
    for (let i = 0; i < nodes.length; i++) {
        if (i === sourceIdx) continue;
        const vec = buildTFIDFVector(corpus[i] ?? [], idf);
        const sim = cosineSimilarity(sourceVec, vec);
        if (sim > SIMILARITY_THRESHOLD) {
            results.push({ nodeId: nodes[i]!.id, similarity: sim, heading: nodes[i]!.data?.heading ?? '' });
        }
    }
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, topN);
}

function getNodeText(node: CanvasNode): string {
    return [node.data?.heading, node.data?.output].filter(Boolean).join(' ');
}

export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    let dot = 0, magA = 0, magB = 0;
    for (const [term, score] of a) {
        dot += score * (b.get(term) ?? 0);
        magA += score * score;
    }
    for (const [, score] of b) magB += score * score;
    return magA > 0 && magB > 0 ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}
```

**`useFindSimilar.ts`** (~35 lines) — on-demand computation, NOT keystroke-driven:

```typescript
export function useFindSimilar() {
    const [sourceNodeId, setSourceNodeId] = useState<string | null>(null);
    const nodes = useCanvasStore((s) => s.nodes);

    // Pre-compute and cache corpus IDF whenever nodes change.
    // findSimilarNodes receives this cache — avoids rebuilding O(n) tokenization per call.
    const cachedIDF = useMemo(() => {
        if (nodes.length === 0) return new Map<string, number>();
        const corpus = nodes.map((n) => tokenizeRaw(getNodeText(n)));
        return buildCorpusIDF(corpus);
    }, [nodes]);

    // useDeferredValue keeps UI responsive during O(n²) TF-IDF computation.
    const deferredSourceId = useDeferredValue(sourceNodeId);

    // isComputing: true in the window between user trigger and deferred computation
    const isComputing = sourceNodeId !== null && deferredSourceId !== sourceNodeId;

    const results = useMemo(
        () => deferredSourceId ? findSimilarNodes(deferredSourceId, nodes, 7, cachedIDF) : [],
        [deferredSourceId, nodes, cachedIDF],
    );

    const findSimilar = useCallback((nodeId: string) => setSourceNodeId(nodeId), []);
    const clearSimilar = useCallback(() => setSourceNodeId(null), []);

    return { results, isActive: sourceNodeId !== null, isComputing, findSimilar, clearSimilar };
}
```

**Context menu integration** (~3 added lines to NodeContextMenu):
- Add `onFindSimilar?: () => void` prop
- Add `<MenuItem icon="🔎" label={strings.search.findSimilar} onClick={action(props.onFindSimilar)} />` under Organize group
- NodeContextMenu stays at ~155 lines (under 300)

### TDD Tests

**findSimilar unit tests** (~80 lines):
```
1. Returns empty for non-existent node
2. Returns empty for node with no text
3. Similar content nodes score high (>0.5)
4. Dissimilar content nodes excluded (below threshold)
5. Results sorted by similarity descending
6. Results capped at topN
7. Source node excluded from results
8. cosineSimilarity returns 1.0 for identical vectors
9. cosineSimilarity returns 0 for orthogonal vectors
10. cosineSimilarity returns 0 for empty vectors
11. getNodeText combines heading + output
```

**useFindSimilar hook tests** (~70 lines):
```
1. Initially returns no results, isActive=false, isComputing=false
2. findSimilar(nodeId) activates and returns results
3. clearSimilar resets to initial state
4. Recomputes when nodes change
5. Handles missing source node gracefully
6. isComputing is true between findSimilar call and deferred computation completing
7. Corpus IDF cache updates when nodes change (not on every findSimilar call)
8. topN defaults to 7 (not 10)
9. Results list never exceeds topN
```

### Tech Debt Checkpoint

- [ ] `tfidfScorer.ts` under 90 lines after addition
- [ ] `findSimilar.ts` under 70 lines (updated signature with `precomputedIDF?` param)
- [ ] `useFindSimilar.ts` under 55 lines
- [ ] `SIMILARITY_THRESHOLD` is 0.15 (not 0.1 — avoids noise results)
- [ ] `topN` default is 7 (not 10 — cognitive load limit for a sidebar)
- [ ] Corpus IDF memoized in `useFindSimilar` keyed on `nodes` (O(n) once per nodes change, not per call)
- [ ] `isComputing` derived from `useDeferredValue` (no `setState` side-effect anti-pattern)
- [ ] `useDeferredValue` wraps `sourceNodeId` — UI stays responsive during O(n²) computation
- [ ] Reuses `tokenizeRaw` from relevanceScorer (DRY)
- [ ] Reuses `buildCorpusIDF` + `buildTFIDFVector` from tfidfScorer (SSOT)
- [ ] `cosineSimilarity` is exported (testable)
- [ ] NodeContextMenu under 160 lines after addition
- [ ] No closure variables in selectors
- [ ] Zero lint errors

---

## Sub-phase 8F: Structural & Security Tests

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/search/__tests__/advancedSearch.structural.test.ts` | NEW | ~50 |

### Structural Tests

```
1. useSearch accepts SearchFilters parameter (return type includes filters)
2. SearchResult includes highlightRanges field
3. useSearch return type includes activeIndex, isFilterBarOpen, toggleFilterBar, setActiveIndex
4. fuzzyMatch is a pure function (no imports of stores/hooks/React)
5. splitByRanges defensively sorts input ranges before processing (sort call present)
6. searchFilters is a pure function (no imports of stores/hooks/React)
7. searchReducer is a pure function (no side effects)
8. searchReducer handles SET_ACTIVE_INDEX and TOGGLE_FILTER_BAR actions
9. findSimilar imports from tfidfScorer (reuse check — DRY)
10. findSimilar imports tokenizeRaw from relevanceScorer (SSOT tokenization)
11. findSimilar SIMILARITY_THRESHOLD >= 0.15 (grep scan — noise filter enforced)
12. No hardcoded strings in search components (grep scan of .tsx files)
13. SearchFilterBar.module.css uses only CSS variables (no hex colors)
14. No dangerouslySetInnerHTML in search components (XSS protection)
15. No `new RegExp(` with user input in search services (ReDoS protection)
16. SearchBar has role="combobox" attribute (WCAG 2.1 AA — grep scan)
17. TagFilterChips has role="checkbox" attribute (accessibility — grep scan)
```

### Security Audit Checklist

| Check | File | Verification |
|-------|------|-------------|
| XSS via highlights | SearchBar.tsx | Uses React elements, not `dangerouslySetInnerHTML` |
| ReDoS | fuzzyMatch.ts | Character comparison, no `RegExp` from user input |
| Query length bomb | searchReducer.ts | `.slice(0, 200)` cap in SET_QUERY |
| Invalid date crash | searchFilters.ts | `isNaN(date.getTime())` guard |
| Tag injection | SearchFilterBar.tsx | Tags rendered as text content, not HTML |
| Prototype pollution | searchReducer.ts | Spread only on known `SearchFilters` shape |

### Accessibility Audit Checklist

| Check | Element | Requirement |
|-------|---------|-------------|
| Search role | `SearchBar` input | `role="combobox"`, `aria-expanded`, `aria-haspopup="listbox"` |
| Results list | Dropdown `<ul>` | `role="listbox"`, `aria-label` from `searchStrings` |
| Result item | Each `<li>` | `role="option"`, `aria-selected` matches `activeIndex` |
| Filter bar | `<section>` | `aria-label="Search filters"` |
| Tag chip | Each `<button>` | `role="checkbox"`, `aria-checked` |
| Global hotkey | `⌘+K` | Does not conflict with browser shortcuts; suppressed inside node editors |

### Tech Debt Checkpoint

- [ ] All 17 structural tests pass
- [ ] Security audit: all 6 checks verified
- [ ] Accessibility audit: all 6 WCAG checks verified
- [ ] `npm run lint` → 0 errors
- [ ] `npm run test` → 100% pass (including all existing tests)
- [ ] `npm run build` → success
- [ ] File audit: no file over 300 lines
- [ ] String audit: no inline strings in search components

---

## Alternatives Worth Considering

Evaluated during planning. None adopted by default — documented for future reference.

### Alt 1: Web Worker for Search (Future-Proofing)

The plan keeps all computation on the main thread. At production scale (1000+ nodes), the fuzzy match + filter pipeline and TF-IDF corpus build should move to a Web Worker.

**Current architecture already enables this** — `fuzzyMatch`, `applyFilters`, and `findSimilarNodes` are pure functions with fully serializable inputs/outputs (plain objects, strings, arrays). A future Worker migration is a transport-layer change, not a rewrite.

**Decision:** Don't add a Worker in Phase 8 (adds build complexity, complicates testing). Document as an explicit migration path. Add a comment to `findSimilarNodes`: `// Pure fn: safe to move to Web Worker when corpus > 1000 nodes`.

### Alt 2: Fuse.js vs Custom Fuzzy Matcher

[Fuse.js](https://fusejs.io/) (~5 KB gzipped) offers battle-tested fuzzy search with weighted multi-field search, extended syntax (`'exact`, `!exclude`, `^prefix`), configurable threshold, and proper Unicode/CJK handling.

**Why we use custom:** Full control over the `fuzzyScore × fieldWeight × recencyBoost` composite, zero runtime dependencies, deterministic scoring that maps directly to BASB retrieval semantics. Fuse.js doesn't surface per-result highlight ranges in the same composable way as our `splitByRanges`/`extractSnippet` pipeline.

**When to reconsider:** If the custom fuzzy produces user-visible quality regressions on non-ASCII content (accented chars, CJK), adopt Fuse.js as a drop-in replacement for `fuzzyMatch` only — the rest of the architecture is unaffected.

### Alt 3: Search History / Recent Searches (Deferred to Phase 8G)

BASB is fundamentally about retrieval patterns. Users repeatedly search for the same topics.

**Proposed feature:**
- Persist last 10 search queries in `localStorage` (key: `eden:search:history`)
- Show as suggestions when input is focused + query is empty
- Deduplicate, most-recent first; clear on `CLEAR_ALL` dispatch
- ~30 lines in a new `useSearchHistory.ts` hook (no new store)

**Not included in Phase 8** because core filter + fuzzy + semantic search should ship and stabilize first. History is purely additive and non-breaking, making it an ideal first-task for Phase 8G.

---

## Phase 8 Summary

### Execution Order

| Sub-phase | What | Why This Order | Build Passes? |
|-----------|------|----------------|---------------|
| **8A.0** | **⌘+K global hotkey + focus** | First: unblocks keyboard-first UX before all other work | Yes |
| 8A | Filter types + predicates | Foundation — pure functions, no UI dependency | Yes |
| 8B | Fuzzy match + highlight + `extractSnippet` (consolidated) | Used by enhanced useSearch in 8C | Yes |
| 8C | Search reducer (+ `activeIndex`, `isFilterBarOpen`) + enhanced useSearch (+ `useDeferredValue`, composite scoring, pagination) | Composes 8A + 8B, backward compatible | Yes |
| 8D | Filter bar UI + `TagFilterChips` + keyboard nav + ARIA + string resources | Consumes 8C hook, renders highlights, keyboard navigable | Yes |
| 8E | Find Similar (TF-IDF cosine, IDF cache, `isComputing` via `useDeferredValue`) | Independent feature, reuses KB scorer | Yes |
| 8F | Structural + security + a11y tests | Validates final state | Yes |

### Net Impact

- **Files created**: 20 (+ Sub-phase 8A.0 shortcut edit, `TagFilterChips.tsx` + test, `extractSnippet` in `fuzzyMatch.ts`, alternatives doc inline)
- **Files edited**: 8 (`search.ts`, `useSearch.ts`, `SearchBar.tsx`, `SearchBar.module.css`, `tfidfScorer.ts`, `NodeContextMenu.tsx`, `strings.ts`, `useKeyboardShortcuts.ts`)
- **Net line count change**: ~+1 250 lines
- **External dependencies added**: 0
- **Zustand stores added**: 0 (search state via `useReducer`, completely isolated)

### Key Architecture Guarantees

| Guarantee | How |
|-----------|-----|
| No "Maximum update depth exceeded" | Zustand selectors only; no bare destructuring |
| No stale closures | Zero `useEffect` in `useSearch`; all derived via `useMemo` |
| No ReactFlow cascade | Search never mutates canvas store; read-only selectors |
| No closure variables in selectors | Structural test enforces |
| One-shot state updates | `useReducer` dispatch → single state transition |
| Input responsiveness at scale | `useDeferredValue` on query in `useSearch`; `useDeferredValue` on `sourceNodeId` in `useFindSimilar` |
| O(n²) cost amortized | Corpus IDF pre-computed and memoized in `useFindSimilar`; rebuilt only when `nodes` changes |
| Keyboard-first UX | ⌘+K global shortcut + ArrowDown/Up/Enter navigation fully covered |
| Accessible | WCAG 2.1 AA: `role="combobox"`, `aria-expanded`, `role="option"`, `aria-selected`, `role="checkbox"` |
| Security compliant | No `dangerouslySetInnerHTML`, no user-input RegExp, query length cap, date NaN guard |
| Backward compatible | Existing `search(query)` / `clear()` API preserved; existing 12 unit tests pass |
| Web Worker ready | All search functions are pure with serializable I/O — Worker migration is transport-layer only |
