# Phase 4: Smart Clustering & Canvas Overview

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

## Problem Statement

As canvases grow beyond 20-30 nodes, users lose the "peripheral vision" advantage that makes canvas thinking superior to flatbed tools. Everything looks like a flat scatter of cards with no visible themes or structure. Spatial proximity is accidental — wherever the user dropped the node — rather than semantic. The minimap shows positions but not meaning. Users cannot answer "what are the main themes in my research?" or "where are the gaps?" at a glance. At low zoom levels, nodes become tiny unreadable rectangles.

## Intended Solution

Two complementary features:

1. **AI-powered clustering**: Users click "Cluster" and the AI groups nodes by content similarity, draws visual boundaries around groups, and labels each cluster. Users can accept (boundaries persist) or dismiss.

2. **Semantic zoom**: At low zoom levels, nodes progressively simplify — first showing only headings, then collapsing to colored badges with cluster labels prominent. This makes the macro structure visible without squinting at tiny text.

## Architecture Decisions

- **New feature module**: `src/features/clustering/` (services + components + types + hooks)
- **TF-IDF reuse**: The existing `tfidfScorer.ts` (pure math) and `relevanceScorer.ts` (tokenization) in `src/features/knowledgeBank/services/` are directly importable. The clustering service builds TF-IDF vectors per node, then computes cosine similarity between them. No code duplication — import the functions.
- **Cluster state as a separate store slice**: `canvasStore.ts` is a **120-line thin orchestrator** that composes 6 factory functions from `canvasStoreActions.ts` (235 lines). While there is line-count headroom, cluster state belongs in a dedicated `clusterSlice.ts` for **separation of concerns** (SRP) — clustering is an independent domain from core canvas CRUD. The slice is composed into `canvasStore` via the same factory pattern used by `createNodeMutationActions`, `createSelectionActions`, etc.
- **Persisted as workspace metadata field** (not a subcollection): Cluster data is small (8 clusters x 10 nodeIds = ~2KB). Storing it as a field on the workspace document avoids a new subcollection, new Firestore rules, and a new load/save cycle. It saves/loads atomically with the workspace.
- **Semantic zoom via global CSS, not conditional rendering**: Swapping components (TipTap editor vs dot) at zoom thresholds causes ALL 500+ nodes to re-render simultaneously — a performance cliff. Instead, set a `data-zoom-level` attribute on the `.react-flow` wrapper and use a **global (non-module) CSS file** (`semanticZoom.css`) with descendant selectors targeting `.react-flow__node` (a non-hashed global class from ReactFlow). CSS Modules would mangle local class names, making ancestor-descendant selectors impossible across component boundaries. Zero React re-renders on zoom change.
- **No auto-arrangement**: Accepting clusters draws boundaries around nodes at their current positions. It does NOT move nodes. Auto-arranging 50+ nodes is a separate force-directed layout feature with its own UX concerns (undo, animation, overlap resolution). Cut from scope.
- **Security**: AI labeling uses the existing Gemini pipeline. Labels are sanitized (length-clamped, trimmed, no HTML).

---

## Sub-phase 4A: Types & Cluster Store Slice

### What We Build

Define cluster types and create a dedicated Zustand store slice for cluster state, composed into the canvas store.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/clustering/types/cluster.ts` | NEW | ~25 |
| `src/features/clustering/stores/clusterSlice.ts` | NEW | ~55 |
| `src/features/clustering/stores/__tests__/clusterSlice.test.ts` | NEW | ~60 |
| `src/features/canvas/stores/canvasStore.ts` | EDIT | +3 lines (compose slice) |

### Implementation

**`cluster.ts`** — types:

```typescript
export interface ClusterGroup {
  readonly id: string;
  readonly nodeIds: readonly string[];
  readonly label: string;
  readonly colorIndex: number;  // 0-7, indexes into CSS variable palette
}

export interface ClusterBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Computed at render time, NOT stored — avoids stale data on drag
export interface ClusterGroupWithBounds extends ClusterGroup {
  readonly bounds: ClusterBounds;
}
```

Key difference from original plan: **No `boundingBox` stored in ClusterGroup**. Bounding boxes are derived at render time from current node positions. This eliminates the entire `updateClusterBounds` action, the `onNodeDragStop` hook, and the stale-bounds problem. Cheaper to compute 8 bounding boxes per frame than to maintain sync.

**Why `colorIndex` not CSS variable name**: Storing `'--cluster-color-1'` as a string in the type is fragile (rename breaks it) and violates separation of concerns (CSS implementation detail in data model). An integer index is pure data; the component maps it to `var(--cluster-color-${index + 1})`.

**`clusterSlice.ts`**:

```typescript
export interface ClusterSlice {
  clusterGroups: readonly ClusterGroup[];
  setClusterGroups: (groups: ClusterGroup[]) => void;
  clearClusterGroups: () => void;
  pruneDeletedNodes: (existingNodeIds: ReadonlySet<string>) => void;
}

// Zustand slice creator pattern
export const createClusterSlice: StateCreator<ClusterSlice> = (set) => ({
  clusterGroups: [],
  setClusterGroups: (groups) => set({ clusterGroups: groups }),
  clearClusterGroups: () => set({ clusterGroups: [] }),
  pruneDeletedNodes: (existingNodeIds) => set((state) => ({
    clusterGroups: state.clusterGroups
      .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => existingNodeIds.has(id)) }))
      .filter((g) => g.nodeIds.length >= 2),
  })),
});
```

**canvasStore.ts** — compose:

```typescript
// Add to canvasStore creation (1 line — follows existing factory spread pattern):
...createClusterSlice(set, get, store),
```

This keeps canvasStore at ~123 lines (well under 300). The store is already a thin orchestrator — this adds one spread line alongside the existing 6 factory spreads.

### TDD Tests

```
1. setClusterGroups replaces cluster state atomically
2. clearClusterGroups resets to []
3. pruneDeletedNodes removes stale nodeIds from all clusters
4. pruneDeletedNodes removes clusters that drop below 2 nodes
5. Initial state has empty clusterGroups
6. Cluster state accessible via selector: useCanvasStore((s) => s.clusterGroups)
```

### Tech Debt Checkpoint

- [ ] clusterSlice under 60 lines
- [ ] canvasStore stays under 300 lines
- [ ] No `any` types
- [ ] No bounding box in stored state (computed at render)
- [ ] Zero lint errors

---

## Sub-phase 4B: Content Similarity & Clustering Algorithm

### What We Build

A pure service that computes pairwise content similarity between nodes using TF-IDF cosine similarity, then groups them via agglomerative clustering.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/clustering/services/similarityService.ts` | NEW | ~80 |
| `src/features/clustering/services/__tests__/similarityService.test.ts` | NEW | ~120 |

### Implementation

**`similarityService.ts`**:

```typescript
import { tokenizeRaw } from '@/features/knowledgeBank/services/relevanceScorer';
import { buildCorpusIDF } from '@/features/knowledgeBank/services/tfidfScorer';

export function computeClusters(
  nodes: readonly CanvasNode[],
  options?: { minClusterSize?: number; similarityThreshold?: number }
): SimilarityResult
```

**Algorithm**:
1. Extract text per node: `(heading ?? '') + ' ' + (output ?? '')` (plain text, strip HTML via existing sanitizer)
2. Tokenize each node's text via `tokenizeRaw()` (preserves duplicates for TF-IDF)
3. Build TF-IDF vectors using `buildCorpusIDF()` from existing `tfidfScorer.ts`
4. Compute cosine similarity matrix (pairwise) — this is the new math:
   ```typescript
   function cosineSimilarity(vecA: Map<string, number>, vecB: Map<string, number>): number
   function buildTfIdfVector(tokens: string[], idfMap: Map<string, number>): Map<string, number>
   ```
5. Agglomerative clustering (average linkage):
   - Start: each node is its own cluster
   - Merge: repeatedly merge the two most similar clusters
   - Stop: when max inter-cluster similarity drops below `similarityThreshold` (default: 0.15)
   - Filter: remove clusters smaller than `minClusterSize` (default: 2)
6. Assign `colorIndex` 0-7 via **round-robin** (`index % 8`). Graph-coloring (adjacent clusters get different colors) was considered but creates a circular dependency: color assignment needs bounding boxes, but bounding boxes are computed at render time in 4D. With 8 colors and typically 3-8 clusters, round-robin already avoids visual confusion. This also keeps the similarity service truly pure — no position data needed.
7. Default labels: `'Cluster 1'`, `'Cluster 2'`, etc. (AI labeling is a separate step)

**Why reuse existing TF-IDF**: `tfidfScorer.ts` already has `buildCorpusIDF()` and `computeTF()`. The clustering service only adds `buildTfIdfVector()` (TF * IDF per term) and `cosineSimilarity()` — two small pure functions. No duplication.

**Complexity**: O(n^2) for the similarity matrix, O(n^2 log n) for agglomerative clustering. For n=500, this is ~250K comparisons — completes in <50ms on modern hardware. For n=1000+, the plan includes an input cap (cluster only the first 500 nodes by content length, rest go to "unclustered").

**Security**: Pure computation on in-memory data. No external calls. No user input used as code.

### TDD Tests

```
1. 2 similar nodes -> grouped in 1 cluster
2. 2 dissimilar nodes -> both unclustered
3. 5 nodes, 3 similar + 2 similar -> 2 clusters
4. Single node -> unclustered (below minClusterSize)
5. All identical content -> 1 cluster containing all
6. All completely different -> all unclustered
7. Empty nodes (no heading/output) -> excluded from clustering
8. colorIndex values are 0-7 (within palette range)
9. colorIndex assigned via round-robin (index % 8)
10. 100 nodes -> completes in < 200ms (performance test)
11. threshold=0 -> every node unclustered (nothing merges)
12. threshold=1 -> all nodes in one cluster
13. Nodes > 500 -> capped, excess goes to unclustered
14. cosineSimilarity of identical vectors -> 1.0
15. cosineSimilarity of orthogonal vectors -> 0.0
```

### Tech Debt Checkpoint

- [ ] File under 100 lines (helper functions extracted if needed)
- [ ] Imports from existing tfidfScorer/relevanceScorer (no reimplementation)
- [ ] Pure functions — no side effects, no store access, no position data
- [ ] colorIndex via round-robin (no dependency on bounding boxes)
- [ ] Input capped at 500 nodes
- [ ] No `any` types
- [ ] Zero lint errors

---

## Sub-phase 4C: AI Cluster Labeling

### What We Build

A service that sends cluster content summaries to Gemini and receives short descriptive labels. Uses a **single batched call** for all clusters (not one call per cluster).

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/clustering/services/clusterLabelService.ts` | NEW | ~50 |
| `src/features/clustering/services/__tests__/clusterLabelService.test.ts` | NEW | ~70 |
| `src/shared/localization/clusterStrings.ts` | NEW | ~25 |

### Implementation

**Why a single batched call**: The original plan fired one Gemini call per cluster (8 clusters = 8 API calls). A single call is cheaper, faster, and avoids rate limiting:

```typescript
export async function labelClusters(
  clusters: readonly ClusterGroup[],
  nodes: readonly CanvasNode[]
): Promise<readonly ClusterGroup[]>
```

**Prompt structure** (single call):

```
You are labeling groups of related ideas. For each numbered group below,
provide a short label (2-4 words) that describes the common theme.
Return ONLY the labels, one per line, in order.

Group 1:
- "Heading A"
- "Heading B"
- "Heading C"

Group 2:
- "Heading D"
- "Heading E"
```

**Response parsing**:
1. Split response by newlines
2. Trim each line, remove leading numbering (e.g., "1. " or "1) ")
3. Clamp each label to 40 characters
4. If fewer lines than clusters, keep default labels for unmatched ones
5. Sanitize: strip HTML tags, trim whitespace

**Budget control**: Max 5 headings per cluster in the prompt. Max 10 clusters per call. If more than 10 clusters, only label the largest 10; rest keep default labels.

**Error handling**: If the Gemini call fails entirely, all clusters keep their default `'Cluster N'` labels. No toast — silent degradation (labels are a nice-to-have, not critical).

**`clusterStrings.ts`**:

```typescript
export const clusterStrings = {
  labels: {
    cluster: 'Cluster',
    suggestClusters: 'Find themes',
    accept: 'Accept',
    dismiss: 'Dismiss',
    clearClusters: 'Clear themes',
    analyzing: 'Analyzing themes...',
    noThemes: 'No clear themes detected',
    unclustered: 'Unclustered',
    foundThemes: (count: number) => `Found ${count} theme${count !== 1 ? 's' : ''}`,
  },
  prompts: {
    labelInstruction: 'You are labeling groups of related ideas. For each numbered group below, provide a short label (2-4 words) that describes the common theme. Return ONLY the labels, one per line, in order.',
    groupPrefix: 'Group',
  },
} as const;
```

### TDD Tests

```
1. Single cluster -> Gemini called with headings -> label updated
2. 3 clusters -> single Gemini call with all 3 groups
3. Gemini error -> all clusters keep default labels, no throw
4. Response line > 40 chars -> truncated
5. Response with fewer lines than clusters -> unmatched keep defaults
6. Response with leading numbers ("1. Label") -> numbers stripped
7. Cluster with > 5 nodes -> only first 5 headings in prompt
8. > 10 clusters -> only 10 largest labeled, rest keep defaults
9. All prompts use clusterStrings constants
10. Labels sanitized: no HTML tags in output
```

### Tech Debt Checkpoint

- [ ] File under 60 lines
- [ ] All strings from clusterStrings
- [ ] Single API call (not per-cluster)
- [ ] Response sanitized (length clamped, trimmed, HTML stripped)
- [ ] Graceful degradation on error
- [ ] Zero lint errors

---

## Sub-phase 4D: Cluster Boundary Renderer

### What We Build

A React component that draws translucent colored boundaries behind clustered nodes with labels. Boundaries are computed from current node positions at render time (no stored bounding boxes).

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/clustering/components/ClusterBoundaries.tsx` | NEW | ~65 |
| `src/features/clustering/components/ClusterBoundaries.module.css` | NEW | ~40 |
| `src/features/clustering/components/__tests__/ClusterBoundaries.test.tsx` | NEW | ~70 |
| `src/features/canvas/components/CanvasView.tsx` | EDIT | +5 lines |
| `src/styles/cluster-colors.css` | NEW | ~15 |
| `src/styles/variables.css` | EDIT | +1 line (import) |

### Implementation

**Why a separate `cluster-colors.css`**: `variables.css` is at **287/300 lines**. While 13 lines of headroom could technically fit a single `@import`, adding 12 color variables inline would overflow. A separate file follows CLAUDE.md's SOLID principle (single responsibility) and is imported by `variables.css` via `@import`.

**`cluster-colors.css`**:

```css
/* Cluster group color palette — 8 hues evenly spaced in oklch */
:root {
  --cluster-color-1: oklch(0.85 0.10 200);  /* cyan */
  --cluster-color-2: oklch(0.85 0.10 140);  /* green */
  --cluster-color-3: oklch(0.85 0.10 310);  /* purple */
  --cluster-color-4: oklch(0.85 0.10 60);   /* amber */
  --cluster-color-5: oklch(0.85 0.10 20);   /* coral */
  --cluster-color-6: oklch(0.85 0.10 260);  /* indigo */
  --cluster-color-7: oklch(0.85 0.10 100);  /* lime */
  --cluster-color-8: oklch(0.85 0.10 350);  /* pink */
  --cluster-bg-opacity: 0.08;
  --cluster-border-opacity: 0.3;
  --cluster-label-opacity: 0.7;
  --cluster-boundary-padding: 40px;
  --cluster-boundary-radius: var(--radius-xl);
}
```

**`ClusterBoundaries.tsx`** — renders ALL boundaries in a single component, **as a sibling of ReactFlow** (not a child):

**Why sibling, not child**: Raw `<div>` elements inside `<ReactFlow>` don't participate in the panning/zooming coordinate system. ReactFlow children are special (panels, backgrounds, controls). Instead, render `ClusterBoundaries` as a sibling (like `SelectionToolbar` and `FocusOverlay` already are) and manually apply the viewport transform from ReactFlow's internal store.

```typescript
interface ClusterBoundariesProps {
  readonly clusters: readonly ClusterGroup[];
  readonly nodes: readonly CanvasNode[];
  readonly variant?: 'committed' | 'preview';
}

export const ClusterBoundaries = React.memo(function ClusterBoundaries({
  clusters, nodes, variant = 'committed',
}: ClusterBoundariesProps) {
  const transform = useStore((s) => s.transform);
  const [tx, ty, scale] = transform;
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const clustersWithBounds = useMemo(() =>
    clusters.map((cluster) => ({
      ...cluster,
      bounds: computeBoundsFromNodes(cluster.nodeIds, nodeMap),
    })).filter((c) => c.bounds !== null),
    [clusters, nodeMap],
  );

  return (
    <div className={styles.layer} style={{
      transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
      transformOrigin: '0 0',
    }}>
      {clustersWithBounds.map((cluster) => (
        <div
          key={cluster.id}
          className={`${styles.boundary} ${variant === 'preview' ? styles.preview : ''}`}
          style={{
            left: `${cluster.bounds.x}px`,
            top: `${cluster.bounds.y}px`,
            width: `${cluster.bounds.width}px`,
            height: `${cluster.bounds.height}px`,
            '--cluster-hue': `var(--cluster-color-${cluster.colorIndex + 1})`,
          } as React.CSSProperties}
          role="group"
          aria-label={cluster.label}
        >
          <span className={styles.label}>{cluster.label}</span>
        </div>
      ))}
    </div>
  );
});
```

The `useStore` import is from `@xyflow/react` — it provides the current viewport transform `[translateX, translateY, scale]`. The outer `.layer` div mirrors the ReactFlow viewport exactly, so boundary positions match node positions.

**`computeBoundsFromNodes`** — pure helper (~15 lines):

```typescript
function computeBoundsFromNodes(
  nodeIds: readonly string[],
  nodeMap: ReadonlyMap<string, CanvasNode>
): ClusterBounds | null {
  const clusterNodes = nodeIds.map((id) => nodeMap.get(id)).filter(Boolean);
  if (clusterNodes.length === 0) return null;

  const padding = 40; // matches --cluster-boundary-padding
  const minX = Math.min(...clusterNodes.map((n) => n.position.x)) - padding;
  const minY = Math.min(...clusterNodes.map((n) => n.position.y)) - padding;
  const maxX = Math.max(...clusterNodes.map((n) => n.position.x + (n.width ?? 200))) + padding;
  const maxY = Math.max(...clusterNodes.map((n) => n.position.y + (n.height ?? 100))) + padding;

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
```

Key difference: **Uses `n.width` and `n.height`**, not just position. The original plan only said "node positions + padding" which would produce boundaries that clip the right/bottom edges of nodes.

**CanvasView.tsx** — insert as a **sibling** of ReactFlow (alongside `SelectionToolbar` and `FocusOverlay`):

```typescript
const clusterGroups = useCanvasStore((s) => s.clusterGroups);

// After </ReactFlow>, before <SelectionToolbar />:
{clusterGroups.length > 0 && (
  <ClusterBoundaries clusters={clusterGroups} nodes={nodes} />
)}
```

**CSS**:
- `.layer`: `position: absolute`, `top: 0`, `left: 0`, `pointer-events: none`, `z-index: 0` (below nodes)
- `.boundary`: `position: absolute`, background uses `var(--cluster-hue)` with opacity, rounded corners, border
- `.preview`: dashed border variant (used during preview phase before accept/dismiss)
- `.label`: positioned above boundary top-left, `font-size: var(--font-size-sm)`, `color: var(--color-text-secondary)`

**Performance**: `React.memo` + `useMemo` on `clustersWithBounds`. Boundaries only re-render when `clusters`, `nodes`, or viewport `transform` changes. `pointer-events: none` on the layer ensures no interference with node interactions. The viewport transform subscription is lightweight — ReactFlow already batches transform updates.

### TDD Tests

```
1. Renders boundary at correct position (accounts for node width/height)
2. Label text matches cluster.label
3. Background color uses cluster colorIndex mapped to CSS variable
4. pointer-events: none on layer div (no click interference)
5. React.memo prevents unnecessary re-renders
6. aria-label set for accessibility
7. No boundaries rendered when clusterGroups is empty
8. Cluster with all deleted nodes -> filtered out (bounds = null)
9. Boundary padding is 40px on each side
10. Layer div applies viewport transform (translate + scale)
11. variant="preview" applies dashed border CSS class
12. variant="committed" (default) applies solid border CSS class
```

### Tech Debt Checkpoint

- [ ] Component under 75 lines
- [ ] variables.css stays under 300 lines (cluster colors in separate file)
- [ ] All CSS uses variables
- [ ] React.memo applied
- [ ] Bounds computed at render (no stored bounding boxes to go stale)
- [ ] No Zustand anti-patterns
- [ ] Zero lint errors

---

## Sub-phase 4E: Cluster Suggestion UI & Orchestration

### What We Build

A "Find themes" button in workspace controls that triggers clustering, shows a preview notification, and lets users accept or dismiss.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/clustering/hooks/useClusterSuggestion.ts` | NEW | ~65 |
| `src/features/clustering/hooks/__tests__/useClusterSuggestion.test.ts` | NEW | ~100 |
| `src/features/clustering/components/ClusterPreviewBar.tsx` | NEW | ~40 |
| `src/features/clustering/components/ClusterPreviewBar.module.css` | NEW | ~25 |
| `src/features/clustering/components/__tests__/ClusterPreviewBar.test.tsx` | NEW | ~50 |
| `src/features/workspace/components/WorkspaceControls.tsx` | EDIT | +8 lines |

### Implementation

**`useClusterSuggestion.ts`**:

```typescript
type ClusterPhase = 'idle' | 'computing' | 'labeling' | 'preview';

interface ClusterSuggestionState {
  phase: ClusterPhase;
  previewGroups: readonly ClusterGroup[] | null;
}

export function useClusterSuggestion(): {
  suggestClusters: () => Promise<void>;
  acceptClusters: () => void;
  dismissClusters: () => void;
  phase: ClusterPhase;
  previewGroups: readonly ClusterGroup[] | null;
}
```

**Flow**:
1. `suggestClusters()`:
   - Set phase to `'computing'`
   - Read nodes from `useCanvasStore.getState().nodes` (fresh, no closure)
   - Call `computeClusters(nodes)` (sync, pure)
   - If no clusters found: toast "No clear themes detected", return to `'idle'`
   - Set phase to `'labeling'`
   - Call `labelClusters(clusters, nodes)` (async, Gemini)
   - Set `previewGroups`, phase to `'preview'`
   - Render preview boundaries (with dashed borders — CSS class `styles.preview`)
2. `acceptClusters()`:
   - Call `useCanvasStore.getState().setClusterGroups(previewGroups)`
   - Clear preview state, return to `'idle'`
3. `dismissClusters()`:
   - Clear preview state, return to `'idle'` (no store mutation)

**Preview rendering**: When `phase === 'preview'`, a **second** `<ClusterBoundaries>` instance is rendered with `variant="preview"` and the preview groups from the hook's local state. This is separate from the committed boundaries — both can coexist (though in practice, you'd only see preview OR committed at a time). The `variant="preview"` prop applies dashed borders via the `.preview` CSS class (defined in 4D). The committed `<ClusterBoundaries>` reads from the store; the preview instance reads from the hook's local `useReducer` state.

```typescript
// In CanvasView or a wrapper:
{clusterGroups.length > 0 && (
  <ClusterBoundaries clusters={clusterGroups} nodes={nodes} />
)}
{previewGroups && (
  <ClusterBoundaries clusters={previewGroups} nodes={nodes} variant="preview" />
)}
```

**Zustand safety**: All store reads use `getState()` inside callbacks. Preview state is local `useReducer` — completely isolated from canvas store.

**`ClusterPreviewBar.tsx`** — floating notification:

```typescript
// Shows: "Found 3 themes  [Accept] [Dismiss]"
// Positioned at bottom-center of canvas, above zoom controls
```

**WorkspaceControls.tsx** — add button:

```typescript
<TooltipButton
  icon={<ClusterIcon />}
  label={clusterStrings.labels.suggestClusters}
  onClick={suggestClusters}
  disabled={phase !== 'idle'}
/>
```

### TDD Tests

**useClusterSuggestion.test.ts**:
```
1. suggestClusters calls computeClusters with current nodes
2. suggestClusters calls labelClusters after computing
3. Preview groups set after successful labeling
4. acceptClusters commits to canvas store (single setState)
5. dismissClusters clears preview without store mutation
6. phase transitions: idle -> computing -> labeling -> preview
7. No clusters found -> toast shown, returns to idle
8. Labeling error -> preview shown with default labels (graceful)
9. No stale closures (uses getState() inside callbacks)
```

**ClusterPreviewBar.test.tsx**:
```
1. Renders theme count text from clusterStrings
2. Accept button calls acceptClusters
3. Dismiss button calls dismissClusters
4. Not rendered when previewGroups is null
5. Shows "Analyzing themes..." during computing/labeling phase
6. All labels from clusterStrings
```

### Tech Debt Checkpoint

- [ ] Hook under 75 lines
- [ ] Component under 50 lines
- [ ] Local useReducer for preview state (no store pollution)
- [ ] All strings from clusterStrings
- [ ] WorkspaceControls stays under 100 lines
- [ ] Zero lint errors

---

## Sub-phase 4F: Semantic Zoom

### What We Build

Progressive node simplification at low zoom levels using CSS-only visibility switching (no React re-renders on zoom change).

### Architecture Decision: CSS-Only Approach

The original plan used conditional rendering (`{zoomLevel === 'dot' ? <Dot/> : <Full/>}`). This causes a **performance cliff**: when crossing a zoom threshold, ALL 500+ nodes unmount their TipTap editors and remount dots simultaneously. A single frame spike.

The CSS approach: set a `data-zoom-level` attribute on the `.react-flow` wrapper and use a **global (non-module) CSS file** with descendant selectors targeting `.react-flow__node` (ReactFlow's non-hashed global class). CSS Modules would mangle local class names (`.contentArea` becomes `_contentArea_abc123`), making ancestor-descendant selectors across component boundaries impossible. Zero React re-renders. TipTap editors stay mounted but invisible (`display: none`), preserving their state.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/hooks/useSemanticZoom.ts` | NEW | ~25 |
| `src/features/canvas/components/CanvasView.tsx` | EDIT | +5 lines |
| `src/styles/semanticZoom.css` | NEW | ~30 |
| `src/features/canvas/hooks/__tests__/useSemanticZoom.test.ts` | NEW | ~30 |

**Why `semanticZoom.css` (global) instead of editing `IdeaCard.module.css`**: CSS Modules mangle class names (`.contentArea` → `_contentArea_abc123`). The `data-zoom-level` attribute lives on the `.react-flow` wrapper (ancestor), and we need to target descendants like `.contentArea` and `.headingSection` inside nodes. CSS Modules scope prevents ancestor selectors from matching descendant classes across component boundaries. A global CSS file can use ReactFlow's non-hashed `.react-flow__node` class combined with `data-` attribute selectors on node elements.

### Implementation

**`useSemanticZoom.ts`** — sets a data attribute on the `.react-flow` wrapper:

```typescript
const HEADING_THRESHOLD = 0.5;
const DOT_THRESHOLD = 0.25;

export type ZoomLevel = 'full' | 'heading' | 'dot';

export function useSemanticZoom(): void {
  const zoom = useStore((s) => s.transform[2]);

  const level: ZoomLevel = zoom >= HEADING_THRESHOLD ? 'full'
    : zoom >= DOT_THRESHOLD ? 'heading'
    : 'dot';

  useEffect(() => {
    const rfWrapper = document.querySelector('.react-flow');
    rfWrapper?.setAttribute('data-zoom-level', level);
  }, [level]);
}
```

**Key insight**: `useEffect` only fires when `level` changes (3 discrete values), not on every zoom tick. And it sets a DOM attribute, not React state — so zero component re-renders.

**Why `document.querySelector('.react-flow')`**: The `.react-flow` wrapper is a non-hashed global class from ReactFlow. Setting `data-zoom-level` on it lets the global `semanticZoom.css` use descendant selectors like `.react-flow[data-zoom-level="heading"] .react-flow__node`. No ref needed — the query is only called on threshold crossings (max 2 times per zoom gesture).

**Remount guard**: On workspace switch, the `.react-flow` element remounts. The `data-zoom-level` attribute would be absent until the `useEffect` fires. Since the default zoom is typically > 0.5, the initial `level` will be `'full'` and the effect fires immediately on mount. No visible flash.

**`src/styles/semanticZoom.css`** — global CSS (not a CSS module):

The approach uses `data-zoom-level` on `.react-flow` (ancestor) and `data-` attributes on node elements. Since CSS Modules mangle class names, we need to target nodes via **data attributes** that we add to the IdeaCard wrapper. Add `data-node-section` attributes to IdeaCard's sub-components (a one-line JSX change per section).

**IdeaCard.tsx** — add data attributes (3 lines changed, not new files):
```typescript
// On IdeaCardContentSection wrapper: data-node-section="content"
// On IdeaCardTagsSection wrapper: data-node-section="tags"  
// On NodeUtilsBar wrapper: data-node-section="utils"
// On IdeaCardHeadingSection wrapper: data-node-section="heading"
// On .ideaCard div: data-node-section="card"
```

**`semanticZoom.css`**:

```css
/* Semantic zoom: heading-only mode — hide content, tags, utils */
.react-flow[data-zoom-level="heading"] [data-node-section="content"],
.react-flow[data-zoom-level="heading"] [data-node-section="tags"],
.react-flow[data-zoom-level="heading"] [data-node-section="utils"] {
  display: none;
}

.react-flow[data-zoom-level="heading"] [data-node-section="heading"] {
  font-size: var(--font-size-sm);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Semantic zoom: dot mode — collapse to colored dot */
.react-flow[data-zoom-level="dot"] [data-node-section="card"] {
  width: var(--semantic-zoom-dot-size, 24px);
  height: var(--semantic-zoom-dot-size, 24px);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.react-flow[data-zoom-level="dot"] [data-node-section="heading"],
.react-flow[data-zoom-level="dot"] [data-node-section="content"],
.react-flow[data-zoom-level="dot"] [data-node-section="tags"],
.react-flow[data-zoom-level="dot"] [data-node-section="utils"] {
  display: none;
}
```

**Why `data-node-section` attributes**: These are stable, non-hashed identifiers that survive CSS Modules mangling. Each sub-component gets a single `data-node-section` attribute added to its outermost wrapper div — a one-line change per component, no structural modifications.

**CanvasView.tsx** — wire the hook (no ref needed):

```typescript
useSemanticZoom(); // Call inside CanvasViewInner — must be inside ReactFlowProvider

// No changes to the wrapper div — data-zoom-level is set on .react-flow internally
```

**Import the global CSS** in `CanvasView.tsx`:
```typescript
import '@/styles/semanticZoom.css';
```

**IdeaCard.tsx** — add data attributes to sub-component wrappers:
```typescript
// .ideaCard div:
<div className={...} data-color={nodeColorKey} data-node-section="card">

// IdeaCardHeadingSection, IdeaCardContentSection, IdeaCardTagsSection:
// Each adds data-node-section="heading" / "content" / "tags" to its root div

// NodeUtilsBar:
// Adds data-node-section="utils" to its root div
```

**Performance**: CSS `display: none` removes elements from layout without unmounting React components. TipTap editors stay alive but invisible. Transitioning between zoom levels is a single DOM attribute change — the browser handles CSS recalculation, not React.

### TDD Tests

```
1. zoom >= 0.5 -> sets data-zoom-level="full"
2. zoom 0.3 -> sets data-zoom-level="heading"
3. zoom 0.2 -> sets data-zoom-level="dot"
4. zoom exactly 0.5 -> "full" (boundary)
5. zoom exactly 0.25 -> "heading" (boundary)
6. Attribute only changes on threshold crossing (not every zoom tick)
7. Hook does not cause component re-render (imperative DOM update)
```

### Tech Debt Checkpoint

- [ ] Hook under 30 lines
- [ ] No React state for zoom level (imperative DOM attribute)
- [ ] CSS uses variables (global file, not CSS module)
- [ ] No conditional rendering in IdeaCard (only data-node-section attributes added)
- [ ] CanvasView stays under 140 lines
- [ ] IdeaCard.tsx stays under 100 lines (only data attribute additions)
- [ ] semanticZoom.css uses data-node-section selectors (CSS Modules safe)
- [ ] Zero lint errors

---

## Sub-phase 4G: Persistence & Cleanup

### What We Build

Save/load cluster groups with workspace data. Prune deleted nodes from clusters on workspace load.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/workspace/services/workspaceService.ts` | EDIT | +8 lines (save/load clusterGroups field) |
| `src/features/workspace/hooks/useWorkspaceLoader.ts` | EDIT | +5 lines (load + prune clusters) |
| `src/features/workspace/types/workspace.ts` | EDIT | +2 lines (add clusterGroups to Workspace type) |

### Implementation

**Why metadata field, not subcollection**: Cluster data is tiny. 8 clusters x 15 nodeIds x 36 chars = ~4KB. It fits easily in the workspace document alongside `canvasSettings`, `name`, etc. This avoids:
- A new Firestore subcollection
- New security rules (`match /clusterGroups/{id}`)
- A separate load/save cycle
- An extra Firestore read on workspace switch

**workspaceService.ts**:

```typescript
// In saveWorkspace():
clusterGroups: removeUndefined(workspace.clusterGroups ?? []),

// In loadWorkspace():
clusterGroups: doc.data().clusterGroups ?? [],
```

**useWorkspaceLoader.ts** — on workspace load:

```typescript
// After loading nodes:
const existingNodeIds = new Set(nodes.map((n) => n.id));
useCanvasStore.getState().setClusterGroups(workspace.clusterGroups ?? []);
useCanvasStore.getState().pruneDeletedNodes(existingNodeIds);
```

**Node deletion integration**: When nodes are deleted, clusters should be pruned. The deletion logic lives in `src/features/canvas/stores/canvasStoreActions.ts` → `createNodeMutationActions` factory function. Add a call to `get().pruneDeletedNodes(new Set(get().nodes.map(n => n.id)))` after the node removal `set()` call inside the `deleteNodes` action. This keeps cluster pruning co-located with node deletion — no separate subscription or save-cycle hook needed.

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/stores/canvasStoreActions.ts` | EDIT | +3 lines (prune after delete) |

### TDD Tests

```
1. Workspace saves with clusterGroups field
2. Workspace loads with clusterGroups -> set in store
3. Workspace without clusterGroups field -> defaults to []
4. Clusters pruned of deleted nodeIds on load
5. Clusters with < 2 nodes after pruning -> removed
```

### Tech Debt Checkpoint

- [ ] workspaceService.ts stays under 300 lines (currently 287, +8 = 295 — tight but safe)
- [ ] canvasStoreActions.ts stays under 300 lines (currently 237, +3 = 240)
- [ ] No new subcollection needed
- [ ] No new Firestore security rules needed
- [ ] Prune on load prevents orphan accumulation
- [ ] Zero lint errors

---

## Sub-phase 4H: Structural & Integration Tests

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/clustering/__tests__/clustering.structural.test.ts` | NEW | ~45 |
| `src/features/clustering/__tests__/clustering.integration.test.ts` | NEW | ~80 |

### Structural Tests

```
1. All clustering files under 300 lines
2. No hardcoded strings in components (grep scan)
3. No any types in clustering feature
4. ClusterBoundaries uses React.memo
5. No Zustand anti-patterns (bare destructuring scan)
6. Cluster color variables defined in cluster-colors.css
7. No bounding boxes stored in ClusterGroup type (computed at render)
8. similarityService imports from existing tfidfScorer (no reimplementation)
9. semanticZoom.css uses data-node-section selectors (not CSS module class names)
10. IdeaCard sub-components have data-node-section attributes
11. ClusterBoundaries rendered as sibling of ReactFlow (not child)
```

### Integration Test

```
1. Full flow: 10 nodes with 2 themes -> computeClusters -> 2 groups -> label -> accept -> boundaries rendered
2. Accept clusters -> save workspace -> reload -> clusters persisted
3. Clear clusters -> boundaries removed
4. Semantic zoom at 0.3 -> data-zoom-level="heading" on .react-flow wrapper
5. Delete node in cluster -> prune on next load -> cluster updated
6. Cluster with all nodes deleted -> cluster removed entirely
```

### Build Gate Checklist (Full Phase 4)

```bash
npx tsc --noEmit          # zero errors
npm run lint               # zero errors
npm run test               # ALL pass
find src/features/clustering -name "*.ts*" | xargs wc -l | awk '$1 > 300'  # empty
```

---

## Phase 4 Summary

### Execution Order

| Phase | What | Why This Order |
|-------|------|----------------|
| 4A | Types + store slice | Foundation: types used everywhere, store needed by all features |
| 4B | Similarity service | Pure algorithm: no deps on UI or store (testable in isolation) |
| 4C | AI labeling service | Depends on 4B output (ClusterGroup[]) |
| 4D | Boundary renderer | Depends on 4A types + 4B output for visual testing |
| 4E | Suggestion UI | Orchestrates 4B + 4C + 4D together |
| 4F | Semantic zoom | Independent of clustering (can ship separately) |
| 4G | Persistence | Depends on 4A (store), 4E (full flow working) |
| 4H | Structural tests | Validates final state of all sub-phases |

### What Was Changed From the Original Plan

| Change | Reason |
|--------|--------|
| Bounding boxes computed at render, not stored | Eliminates `updateClusterBounds` action, `onNodeDragStop` hook, and stale-bounds bugs. 8 bounding boxes are trivial to compute per frame. |
| Cluster store as separate slice, not inline in canvasStore | `canvasStore.ts` is a 120-line thin orchestrator (not 282 as originally estimated — already refactored into factory pattern). Separate slice is still correct for SRP, not line-count overflow. |
| Cluster colors in separate CSS file | `variables.css` is at 287/300 lines. Separate file follows SRP even though 13 lines of headroom exist. |
| `colorIndex: number` instead of `color: string` | Separates data model from CSS implementation. Pure number is easier to test, serialize, and doesn't break if CSS variable names change. |
| colorIndex via round-robin, not graph-coloring | Graph-coloring requires bounding boxes (computed at render in 4D), creating a circular dependency. Round-robin with 8 colors is sufficient for 3-8 clusters. Keeps similarity service pure (no position data). |
| Single batched Gemini call for labeling | Original: 1 call per cluster (8 clusters = 8 API calls). Batched: 1 call total. Cheaper, faster, no rate limiting. |
| CSS-only semantic zoom via global CSS file | Original: conditional rendering swaps TipTap/dot. This causes 500+ simultaneous unmount/mount. CSS `display:none` is zero-cost. Uses global CSS (not CSS module) with `data-node-section` attributes to avoid class name mangling across component boundaries. |
| ClusterBoundaries as ReactFlow sibling, not child | Raw `<div>` children of `<ReactFlow>` don't participate in the panning/zooming coordinate system. Rendered as sibling with manual viewport transform via `useStore((s) => s.transform)` — same pattern as `SelectionToolbar` and `FocusOverlay`. |
| ClusterBoundaries `variant` prop for preview | Preview rendering uses a second `<ClusterBoundaries variant="preview">` instance (dashed borders) alongside committed boundaries, rather than mixing preview state into the store. |
| Node deletion pruning in canvasStoreActions.ts | Explicit location: `createNodeMutationActions` → `deleteNodes` action calls `pruneDeletedNodes` after node removal. |
| No auto-arrangement on accept | Auto-arranging 50+ nodes is a major UX feature (undo, animation, overlap). Cut from scope — ship boundaries first. |
| Persistence as workspace field, not subcollection | Cluster data is ~4KB. Subcollection adds: new Firestore rules, new load/save cycle, new security surface. Not worth it. |
| Node width/height in bounds calculation | Original only used `position` (top-left corner). Boundaries would clip node right/bottom edges. |
| Input cap at 500 nodes | Agglomerative clustering is O(n^2 log n). Uncapped at 1000+ nodes = multi-second computation. |
| Added Sub-phase 4G (Persistence) | Original plan said "serialized alongside nodes/edges" but didn't specify how. Needed explicit implementation. |
| `workspaceService.ts` listed as affected file | Original plan didn't mention this 287-line file at all, despite it being the persistence layer. |

### Tech Debt Audit

| Potential Debt | How We Prevent It |
|---------------|-------------------|
| Duplicate TF-IDF logic | Direct imports from existing `tfidfScorer.ts` + `relevanceScorer.ts` |
| canvasStore SRP violation | Cluster state in dedicated `clusterSlice.ts` composed via Zustand factory pattern (canvasStore is 120 lines, not at overflow risk — separation is for SRP, not line count) |
| variables.css overflow | Cluster colors in separate `cluster-colors.css` imported by variables.css |
| Stale bounding boxes | No stored bounds — computed at render from live node positions |
| Performance cliff on zoom | CSS-only zoom via global `semanticZoom.css` (DOM attribute + `data-node-section` selectors, zero React re-renders, CSS Modules safe) |
| CSS Modules class mangling | Semantic zoom uses `data-node-section` attributes (not class names) for cross-component selectors. ClusterBoundaries uses its own CSS module (no cross-boundary class refs). |
| ClusterBoundaries viewport sync | Sibling rendering with manual viewport transform from `useStore((s) => s.transform)` — proven pattern used by SelectionToolbar/FocusOverlay |
| O(n^2) at scale | Input capped at 500 nodes; excess goes to "unclustered" |
| API cost per cluster | Single batched Gemini call for all labels (not per-cluster) |
| Orphaned nodeIds | `pruneDeletedNodes` runs on workspace load and node deletion (in `canvasStoreActions.ts`) |
| Hardcoded colors | 8-color palette as CSS variables in dedicated file |
| Zustand anti-patterns | All callbacks use getState(); preview state in local useReducer |
| Firestore complexity | Metadata field (not subcollection) — no new rules, no new load cycle |
| workspaceService.ts line count | Currently 287 + 8 = 295 lines. Safe but tight — monitor if other features land first |

### Net Impact

**Net new files**: 17 (9 source + 3 CSS + 5 test)
**Files modified**: 11 (canvasStore, canvasStoreActions, CanvasView, WorkspaceControls, workspaceService, useWorkspaceLoader, workspace type, IdeaCard.tsx, IdeaCardContentSection.tsx, IdeaCardTagsSection.tsx, NodeUtilsBar.tsx — last 4 are single-line `data-node-section` attribute additions)
**Estimated total new lines**: ~1,250 (source + tests)
**canvasStore.ts**: stays at ~123 lines (thin orchestrator with factory spreads)
**canvasStoreActions.ts**: stays at ~240 lines (pruneDeletedNodes call added)
**workspaceService.ts**: stays at ~295 lines (tight but under 300)
**variables.css**: stays at ~288 lines (under 300)
