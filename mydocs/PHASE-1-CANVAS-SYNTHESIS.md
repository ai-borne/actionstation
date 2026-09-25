# Phase 1: Canvas Synthesis — The Killer Feature

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

## Problem Statement

Users build rich context chains on the canvas — connecting nodes, generating AI content, attaching documents — but there is **no way to harvest spatial thinking into coherent output**. The canvas is a thinking tool with no "finish line." This is BASB's "Express" move and the app's biggest gap. A user who connects 8 nodes exploring a business strategy has no way to say "now turn this into a one-page brief." They must manually copy-paste and restructure — defeating the purpose of canvas thinking.

## Intended Solution

Let users select any group of connected nodes and trigger AI synthesis that **respects canvas topology**. Parent nodes become context, child nodes become elaborations, sibling nodes become parallel arguments. The AI produces a coherent document (summary, outline, narrative, or gap analysis) that lands as a new "synthesis node" on the canvas — a visible artifact of distilled thinking. Synthesis nodes store their source IDs, enabling **iterative re-synthesis** as thinking evolves.

## Architecture Decision

- **New feature module**: `src/features/synthesis/` (MVVM, feature-first)
- **Isolated from canvas store**: Synthesis dispatches a single atomic `setState` — no intermediate state mutations
- **No new Zustand store**: Uses `useCanvasStore` for node/edge reads (via selectors); synthesis UI state in local `useReducer`
- **Context budget**: Reuses existing token budget system from `nodePoolBuilder.ts`. Adds `'synthesis'` to **both** `NodePoolGenerationType` (in `src/features/ai/types/nodePool.ts` — current values: `'single' | 'chain' | 'transform'`) and `KBGenerationType` (in `src/features/knowledgeBank/types/knowledgeBank.ts`), each with reduced allocation (~3,000 tokens) since the synthesis prompt itself is the primary context
- **ID generation**: Uses `idea-${crypto.randomUUID()}` for nodes, `edge-${crypto.randomUUID()}` for edges. **Note**: The codebase has two ID patterns — `Date.now()` in `useAddNode.ts` and `crypto.randomUUID()` in `useNodeGeneration.ts`. We standardize on `crypto.randomUUID()` for synthesis to avoid collisions when creating multiple nodes in rapid succession (synthesis node + edges in <1ms).
- **Security**: All user content sanitized before prompt injection into Gemini calls; no raw HTML in prompts

---

## Sub-phase 1A: Subgraph Traversal & Context Builder

### What We Build

A service that takes selected node IDs, walks the subgraph, topologically sorts them, and produces a structured AI prompt that makes relationships explicit.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/synthesis/services/subgraphTraversal.ts` | NEW | ~65 |
| `src/features/synthesis/services/__tests__/subgraphTraversal.test.ts` | NEW | ~140 |

### Implementation

**`subgraphTraversal.ts`**:

```typescript
// Types
interface SynthesisNode {
  readonly id: string;
  readonly heading: string;
  readonly content: string;          // output || ''
  readonly attachmentSummary: string; // first attachment extraction summary || ''
  readonly depth: number;            // 0 = root, 1 = child, etc.
  readonly childIds: readonly string[];
}

interface SynthesisGraph {
  readonly roots: readonly SynthesisNode[];
  readonly rootIds: readonly string[];     // IDs of root nodes (for edge creation)
  readonly allNodes: readonly SynthesisNode[];
  readonly totalTokenEstimate: number;
}

// Functions
export function buildSynthesisGraph(
  selectedIds: ReadonlySet<string>,
  allNodes: readonly CanvasNode[],
  allEdges: readonly CanvasEdge[]
): SynthesisGraph
```

**Algorithm**:
1. Filter edges to only those where BOTH source and target are in `selectedIds`
2. Build adjacency map: `parentId → childIds[]`
3. Find roots: nodes with no incoming edges within the selection
4. If no roots found (cycle), pick node with most outgoing edges as root. **Tiebreaker**: if multiple nodes have equal outgoing edges, pick the one with the lexicographically smallest `id` for deterministic results.
5. BFS from roots, assigning depth. Track visited to handle cycles (skip revisits)
6. For each node, extract: `heading` (from `ideaData.heading || ideaData.prompt || ''`), `content` (from `ideaData.output || ''`), `attachmentSummary` (first attachment's `extraction?.summary || ''`)
7. Estimate tokens: `(heading.length + content.length + attachmentSummary.length) / 4` per node
8. Return `SynthesisGraph` with roots, `rootIds` (root node IDs for edge creation), flat allNodes list, and total token estimate

**Security**: All text fields read from store are plain strings (React already escapes). No user input is used as code or URLs. Attachment summaries are pre-sanitized by the document agent pipeline.

### TDD Tests

```
RED → GREEN cycle for each:
1. Single node selection → returns graph with 1 root, depth 0
2. Linear chain A→B→C → root=A (depth 0), B (depth 1), C (depth 2)
3. Diamond A→B, A→C, B→D, C→D → D visited once, correct depth
4. Cycle A→B→C→A → picks highest-outdegree as root, no infinite loop
5. Disconnected clusters {A→B} + {C→D} → two roots
6. Node with no heading/output → empty strings, no crash
7. Nodes outside selection ignored even if edges connect to them
8. Token estimate matches expected calculation
9. Empty selection → empty graph (roots=[], allNodes=[])
10. Node with attachment extraction → attachmentSummary populated
11. rootIds contains exactly the root node IDs (not all node IDs)
12. Synthesis node in selection (recursive synthesis) → treated like any node (heading + output read correctly)
```

### Tech Debt Checkpoint

- [ ] File under 300 lines
- [ ] All strings from string resources (none needed — this is a pure data service)
- [ ] No `any` types
- [ ] No Zustand calls in this service (pure function, receives data as args)
- [ ] Zero lint errors

---

## Sub-phase 1B: Synthesis Prompt Templates

### What We Build

Four prompt templates that receive a `SynthesisGraph` and produce a structured Gemini prompt. Templates use string resources for all user-facing labels.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/synthesis/services/synthesisPrompts.ts` | NEW | ~90 |
| `src/features/synthesis/services/__tests__/synthesisPrompts.test.ts` | NEW | ~120 |
| `src/shared/localization/synthesisStrings.ts` | NEW | ~45 |
| `src/shared/localization/strings.ts` | EDIT | +3 lines (import + add to strings obj) |

### Implementation

**`synthesisStrings.ts`**:

```typescript
export const synthesisStrings = {
  modes: {
    summarize: 'Summarize',
    outline: 'Outline',
    narrative: 'Narrative',
    questions: 'Find Gaps',
  },
  modeDescriptions: {
    summarize: 'Distill into a concise summary',
    outline: 'Create a structured outline',
    narrative: 'Write a cohesive document',
    questions: 'Identify gaps and open questions',
  },
  labels: {
    synthesisOf: 'Synthesis of',  // "Synthesis of 5 ideas"
    ideas: 'ideas',
    selectNodes: 'Select connected nodes to synthesize',
    synthesize: 'Synthesize',
    reSynthesize: 'Re-synthesize',
    generating: 'Synthesizing...',
    noSelection: 'Select 2 or more connected nodes',
    tooManyNodes: 'Select fewer than 50 nodes for best results',
  },
  prompts: {
    summarizeInstruction: 'Distill the following connected ideas into a concise, well-structured summary. Preserve key insights and their relationships.',
    outlineInstruction: 'Create a structured outline from these connected ideas. Use the hierarchy (parent → child) to determine section nesting. Each idea becomes a section or subsection.',
    narrativeInstruction: 'Write a coherent, flowing document that synthesizes these connected ideas into a unified argument or explanation. Use transitions between sections. The document should read as a single authored piece, not a list of separate ideas.',
    questionsInstruction: 'Analyze the following connected ideas and identify what is MISSING. What questions remain unanswered? What assumptions are untested? What gaps exist in the reasoning? Return a numbered list of open questions and gaps, grouped by theme.',
    contextPrefix: 'The user has built a visual canvas of connected ideas. The ideas are listed below in topological order (parents before children). Indentation indicates depth — deeper ideas elaborate on their parent.',
    nodeTemplate: 'Idea',         // "Idea 1 (depth 0): Heading"
    depthLabel: 'depth',
    childrenNote: 'elaborates on', // "elaborates on Idea 1"
  },
} as const;
```

**`synthesisPrompts.ts`**:

```typescript
export type SynthesisMode = 'summarize' | 'outline' | 'narrative' | 'questions';

export function buildSynthesisPrompt(
  graph: SynthesisGraph,
  mode: SynthesisMode
): string
```

**Prompt structure**:
```
[System instruction from synthesisStrings.prompts based on mode]

[contextPrefix]

Idea 1 (depth 0): "Node Heading"
  Content: Node output text...
  Attachment: Summary of attached document...
  → Children: Idea 2, Idea 3

  Idea 2 (depth 1, elaborates on Idea 1): "Child Heading"
    Content: ...

  Idea 3 (depth 1, elaborates on Idea 1): "Another Child"
    Content: ...

    Idea 4 (depth 2, elaborates on Idea 3): "Grandchild"
      Content: ...
```

**Security**: Prompt template uses `synthesisStrings` constants — no user input interpolated into system instructions. Node content is placed in clearly delimited blocks (quoted headings, indented content). This follows the existing pattern in `documentAgentPrompts.ts`.

### TDD Tests

```
1. summarize mode → prompt contains summarizeInstruction
2. outline mode → prompt contains outlineInstruction
3. narrative mode → prompt contains narrativeInstruction
4. questions mode → prompt contains questionsInstruction
5. Node headings appear in quotes
6. Depth indentation correct (2 spaces per level)
7. Children listed with "elaborates on" parent reference
8. Attachment summary included when present
9. Empty content/attachment → those sections omitted (no "Content: " with nothing)
10. All strings sourced from synthesisStrings (structural grep test)
11. 50-node graph → prompt under 100K chars (truncation safety)
```

### Tech Debt Checkpoint

- [ ] Files under 300 lines
- [ ] All user-facing strings in `synthesisStrings.ts`
- [ ] No hardcoded strings in prompt builder
- [ ] `strings.ts` aggregator updated cleanly
- [ ] Zero lint errors

---

## Sub-phase 1C: Synthesis Node Factory

### What We Build

A factory function that constructs a fully-formed synthesis `CanvasNode` with `colorKey: 'synthesis'`, pre-populated `heading`, `output`, and `synthesisSourceIds` for re-synthesis. This is needed because the codebase's `createIdeaNode(id, workspaceId, position, prompt?)` only accepts a flat `prompt` string and defaults `colorKey` to `'default'` — it cannot set `heading`, `output`, or `colorKey` in one call.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/synthesis/services/synthesisNodeFactory.ts` | NEW | ~45 |
| `src/features/synthesis/services/__tests__/synthesisNodeFactory.test.ts` | NEW | ~70 |

### Implementation

**`synthesisNodeFactory.ts`**:

```typescript
import { createIdeaNode } from '@/features/canvas/types/node';
import type { CanvasNode, NodePosition } from '@/features/canvas/types/node';
import type { SynthesisMode } from './synthesisPrompts';

interface CreateSynthesisNodeParams {
  readonly workspaceId: string;
  readonly position: NodePosition;
  readonly heading: string;
  readonly output: string;
  readonly sourceNodeIds: readonly string[];
  readonly mode: SynthesisMode;
}

export function createSynthesisNode(params: CreateSynthesisNodeParams): CanvasNode {
  const id = `idea-${crypto.randomUUID()}`;
  const baseNode = createIdeaNode(id, params.workspaceId, params.position);

  return {
    ...baseNode,
    data: {
      ...baseNode.data,
      heading: params.heading,
      output: params.output,
      colorKey: 'synthesis',
      synthesisSourceIds: [...params.sourceNodeIds],
      synthesisMode: params.mode,
    },
  };
}

export function createSynthesisEdges(
  workspaceId: string,
  rootNodeIds: readonly string[],
  synthesisNodeId: string
): CanvasEdge[] {
  return rootNodeIds.map((sourceId) =>
    createEdge(
      `edge-${crypto.randomUUID()}`,
      workspaceId,
      sourceId,
      synthesisNodeId,
      'derived'
    )
  );
}
```

**Key design decisions**:
- **Extends `createIdeaNode`**: Calls the base factory first, then spreads additional fields. This ensures any future changes to base node creation are inherited.
- **`synthesisSourceIds`**: Stored on node data so re-synthesis can reconstruct the selection. This is a `string[]` of ALL selected node IDs (not just roots).
- **`synthesisMode`**: Stored so re-synthesis defaults to the same mode.
- **Edges from roots only**: `createSynthesisEdges` receives `rootNodeIds` (from `SynthesisGraph.rootIds`), NOT all selected IDs. This avoids spider-web visual noise for large selections — the topology already captures the rest.
- **ID generation**: Uses `crypto.randomUUID()` for both nodes and edges — avoids `Date.now()` collisions when creating synthesis node + multiple edges in rapid succession (<1ms). See Architecture Decision for rationale.

### TDD Tests

```
1. Creates node with colorKey='synthesis'
2. Creates node with correct heading and output
3. Creates node with synthesisSourceIds matching input
4. Creates node with synthesisMode matching input
5. Node id follows 'idea-${uuid}' pattern (crypto.randomUUID)
6. Node position matches input
7. Node workspaceId matches input
8. createSynthesisEdges creates N edges for N root IDs
9. All edges have relationshipType='derived'
10. All edge IDs follow 'edge-${uuid}' pattern (crypto.randomUUID)
11. All edges point from source roots to synthesis node
```

### Tech Debt Checkpoint

- [ ] File under 300 lines
- [ ] No `any` types
- [ ] Reuses `createIdeaNode` and `createEdge` from existing types
- [ ] Zero lint errors

---

## Sub-phase 1D: `useSynthesis` Hook

### What We Build

The hook that orchestrates: read selected nodes → build graph → build prompt → call Gemini → create synthesis node + edges. Uses Zustand selectors for state, `getState()` for actions. Single atomic canvas update.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/synthesis/hooks/useSynthesis.ts` | NEW | ~75 |
| `src/features/synthesis/hooks/__tests__/useSynthesis.test.ts` | NEW | ~170 |

### Implementation

**`useSynthesis.ts`**:

```typescript
import type { SynthesisMode } from '../services/synthesisPrompts';

interface UseSynthesisReturn {
  readonly synthesize: (mode: SynthesisMode) => Promise<void>;
  readonly reSynthesize: (nodeId: string, mode?: SynthesisMode) => Promise<void>;
  readonly isSynthesizing: boolean;
  readonly error: string | null;
  readonly canSynthesize: boolean;  // true when ≥2 nodes selected
}

export function useSynthesis(): UseSynthesisReturn
```

**Internal flow**:

```typescript
// State — local useReducer (NOT Zustand) for synthesis-specific UI state
// This isolates transient synthesis state from the canvas store entirely
const [state, dispatch] = useReducer(synthesisReducer, initialState);

// Zustand selectors — stable, no closure variables
const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);

// KB context hook — called at top level (hook rules)
const { getKBContext } = useKnowledgeBankContext();

// Workspace ID
const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

const canSynthesize = selectedNodeIds.size >= 2;

const synthesize = useCallback(async (mode: SynthesisMode) => {
  // 1. Guard: need ≥2 selected nodes
  const currentSelected = useCanvasStore.getState().selectedNodeIds;
  if (currentSelected.size < 2) return;

  // 2. Build graph (pure function, no store mutation)
  const currentNodes = useCanvasStore.getState().nodes;
  const currentEdges = useCanvasStore.getState().edges;
  const graph = buildSynthesisGraph(currentSelected, currentNodes, currentEdges);
  if (graph.allNodes.length === 0) return;

  // 3. Build prompt
  const prompt = buildSynthesisPrompt(graph, mode);

  // 4. Get KB context (synchronous — uses getState() internally)
  const kbContext = getKBContext(prompt, 'synthesis');

  // 5. Call Gemini
  dispatch({ type: 'START' });
  try {
    const content = await generateContentWithContext(
      prompt, [], '', kbContext  // empty context chain array, no pool context
    );

    // 6. Create synthesis node — position to the right of selection bounding box
    const position = calculateSynthesisPosition(currentNodes, currentSelected);
    const heading = `${synthesisStrings.labels.synthesisOf} ${graph.allNodes.length} ${synthesisStrings.labels.ideas}`;
    const newNode = createSynthesisNode({
      workspaceId: workspaceId ?? '',
      position,
      heading,
      output: content,
      sourceNodeIds: Array.from(currentSelected),
      mode,
    });

    // 7. Create edges from ROOT nodes only to synthesis node (not all selected — avoids visual noise)
    const newEdges = createSynthesisEdges(
      workspaceId ?? '',
      graph.rootIds,
      newNode.id
    );

    // 8. SINGLE ATOMIC UPDATE — one setState call, completely isolated
    useCanvasStore.setState((s) => ({
      nodes: [...s.nodes, newNode],
      edges: [...s.edges, ...newEdges],
    }));

    dispatch({ type: 'COMPLETE' });
  } catch (err) {
    dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : synthesisStrings.labels.generating });
  }
}, [workspaceId, getKBContext]);

const reSynthesize = useCallback(async (nodeId: string, mode?: SynthesisMode) => {
  // 1. Find existing synthesis node
  const nodes = useCanvasStore.getState().nodes;
  const targetNode = nodes.find(n => n.id === nodeId);
  if (!targetNode?.data.synthesisSourceIds) return;

  // 2. Reconstruct selection from stored source IDs
  const sourceIds = new Set<string>(targetNode.data.synthesisSourceIds as string[]);
  // Filter to only still-existing nodes
  const existingIds = new Set(nodes.filter(n => sourceIds.has(n.id)).map(n => n.id));
  if (existingIds.size < 2) return;

  // 3. Build graph + prompt from stored sources
  const currentEdges = useCanvasStore.getState().edges;
  const graph = buildSynthesisGraph(existingIds, nodes, currentEdges);
  if (graph.allNodes.length === 0) return;

  const resolvedMode = mode ?? (targetNode.data.synthesisMode as SynthesisMode) ?? 'summarize';
  const prompt = buildSynthesisPrompt(graph, resolvedMode);
  const kbContext = getKBContext(prompt, 'synthesis');

  dispatch({ type: 'START' });
  try {
    const content = await generateContentWithContext(prompt, [], '', kbContext);

    // 4. Update existing synthesis node in-place (not create new)
    useCanvasStore.getState().updateNodeOutput(nodeId, content);
    useCanvasStore.getState().updateNodeHeading(nodeId,
      `${synthesisStrings.labels.synthesisOf} ${graph.allNodes.length} ${synthesisStrings.labels.ideas}`
    );

    dispatch({ type: 'COMPLETE' });
  } catch (err) {
    dispatch({ type: 'ERROR', error: err instanceof Error ? err.message : synthesisStrings.labels.generating });
  }
}, [workspaceId, getKBContext]);
```

**Critical patterns**:
- `selectedNodeIds` read via selector for reactive `canSynthesize` derivation
- Inside `synthesize` callback: read fresh via `getState()` (not stale closure values)
- `getKBContext` called at hook top level via `useKnowledgeBankContext()`, captured in closure — it's a stable `useCallback` reference internally and is **synchronous**
- `generateContentWithContext` receives `string[]` as second arg (empty array `[]` — no chain context, the prompt IS the context)
- Canvas mutation is ONE `setState` call — no intermediate renders, no cascade risk
- Synthesis state (`isSynthesizing`, `error`) in local `useReducer` — completely isolated from canvas store
- **Re-synthesis** updates the existing node in-place rather than creating a new one

**`calculateSynthesisPosition`** (helper in same file or extracted if >20 lines):
- Compute bounding box of selected nodes
- Place synthesis node at `{ x: bbox.right + 120, y: bbox.centerY - defaultHeight/2 }`
- Snap to grid using imported `SNAP_GRID` constant from `canvasViewConstants.ts` (`[16, 16]`)

### TDD Tests

```
1. synthesize('summarize') → calls buildSynthesisGraph with correct args
2. synthesize('outline') → calls buildSynthesisPrompt with 'outline' mode
3. synthesize('questions') → calls buildSynthesisPrompt with 'questions' mode
4. Result creates new node with heading "Synthesis of N ideas"
5. Result creates edges only from ROOT nodes (not all selected)
6. Canvas setState called exactly ONCE (atomic update test)
7. isSynthesizing = true during generation, false after
8. canSynthesize = true when ≥2 nodes selected, false otherwise
9. Error from Gemini → sets error state, no node created
10. <2 selected nodes → synthesize returns early, no API call
11. Position calculated to the right of selection bounding box, snapped to SNAP_GRID
12. KB context fetched synchronously and passed to Gemini as 4th arg
13. generateContentWithContext called with empty array [] as contextChain
14. workspaceId correctly propagated to new node and edges
15. No stale closure: modifying selection during synthesis doesn't corrupt output
16. New node has synthesisSourceIds = all selected IDs (for re-synthesis)
17. New node has synthesisMode = mode used
18. reSynthesize: reads synthesisSourceIds from existing node
19. reSynthesize: filters out deleted source nodes (still works if ≥2 remain)
20. reSynthesize: updates existing node output in-place (no new node)
21. reSynthesize: defaults to stored synthesisMode when mode not specified
22. reSynthesize: returns early if source node has no synthesisSourceIds
```

**Integration test** (in same file):
```
23. Full flow: mock 3 connected nodes → select → synthesize('narrative') →
    verify new node content matches Gemini response, edges connect from roots only,
    graph topology was respected in prompt
24. Recursive synthesis: synthesis node + 2 regular nodes selected → synthesize →
    synthesis node's output included in prompt as regular content, new synthesis created
```

### Tech Debt Checkpoint

- [ ] Hook under 75 lines (extract `reSynthesize` to separate helper if needed)
- [ ] `useReducer` for local state — not Zustand
- [ ] Single `setState` for canvas mutation (new synthesis), `getState()` calls for re-synthesis
- [ ] No closure variables in Zustand selectors
- [ ] All action calls via `getState()`
- [ ] `useKnowledgeBankContext()` called at hook top level (not inside callback)
- [ ] `getKBContext` is synchronous — no `await`
- [ ] No `any` types
- [ ] No `useEffect` (this is a callback-driven hook, not reactive)
- [ ] Zero lint errors

---

## Sub-phase 1E: Selection Toolbar UI

### What We Build

A floating toolbar that appears when 2+ nodes are selected, offering the "Synthesize" action with a mode picker popover.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/synthesis/components/SelectionToolbar.tsx` | NEW | ~60 |
| `src/features/synthesis/components/SelectionToolbar.module.css` | NEW | ~65 |
| `src/features/synthesis/components/SynthesisModePopover.tsx` | NEW | ~55 |
| `src/features/synthesis/components/SynthesisModePopover.module.css` | NEW | ~50 |
| `src/features/synthesis/components/__tests__/SelectionToolbar.test.tsx` | NEW | ~80 |
| `src/features/synthesis/components/__tests__/SynthesisModePopover.test.tsx` | NEW | ~80 |
| `src/features/canvas/components/CanvasView.tsx` | EDIT | +5 lines (render SelectionToolbar) |

### Implementation

**`SelectionToolbar.tsx`** — React.memo component:

```typescript
export const SelectionToolbar = React.memo(function SelectionToolbar() {
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const nodeCount = selectedNodeIds.size;  // derived from selector, not closure in selector

  if (nodeCount < 2) return null;

  // Position: anchored to selection bounding box
  // Floats above/below the selection center, avoids collision with Phase 4 ClusterPreviewBar
  // which occupies the fixed bottom-center of viewport

  return (
    <div className={styles.toolbar} role="toolbar" aria-label={synthesisStrings.labels.synthesize}>
      <span className={styles.count}>
        {nodeCount} {synthesisStrings.labels.ideas}
      </span>
      <button
        className={styles.synthesizeBtn}
        onClick={handleOpenPopover}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <SynthesizeIcon size={16} />
        {synthesisStrings.labels.synthesize}
      </button>
      {isOpen && (
        <SynthesisModePopover
          onSelect={handleModeSelect}
          onClose={handleClose}
        />
      )}
    </div>
  );
});
```

**Position strategy**: The toolbar computes a bounding box from the selected nodes' positions (using `getState()` once on mount/selection change) and positions itself at `{ x: bbox.centerX, y: bbox.top - 60 }` in canvas coordinates, transformed to screen coordinates via ReactFlow's `useStore((s) => s.transform)`. This keeps the action spatially near the selection — unlike a fixed viewport position which disconnects action from context. Falls back to fixed bottom-center if selection spans > 80% of viewport.

**`SynthesisModePopover.tsx`** — four-button popover:

```typescript
// Four mode buttons: Summarize, Outline, Narrative, Find Gaps
// Each shows mode name + 1-line description from synthesisStrings.modeDescriptions
// onClick → calls useSynthesis().synthesize(mode) → closes popover
// Keyboard: arrow keys navigate, Enter selects, Escape closes
```

**CSS** — all CSS variables:
- `background: var(--color-surface-elevated)`
- `border: 1px solid var(--color-border)`
- `box-shadow: var(--shadow-dropdown)`
- `border-radius: var(--radius-lg)`
- Transitions: `opacity` + `transform` for smooth appear/disappear
- Position: absolute relative to toolbar parent (not fixed viewport)

**CanvasView.tsx edit**: Add `<SelectionToolbar />` as sibling of `<ZoomControls />` inside the canvas wrapper. No props needed — it reads selection from store selector.

**Phase 2 extensibility note**: The toolbar layout should accommodate 2 additional buttons that Phase 2 will add ("Copy as markdown" and "Export selection"). Use a flex row with gap — Phase 2 inserts buttons as siblings of the Synthesize button. Design the CSS with this growth in mind (e.g., `display: flex; gap: var(--space-2)`).

**Zustand safety**:
- `useCanvasStore((s) => s.selectedNodeIds)` — single selector, stable reference via `EMPTY_SELECTED_IDS`
- `nodeCount` derived in component body, NOT inside selector
- Bounding box computation uses `getState()` (not selector — position changes during drag shouldn't re-render the toolbar)
- Popover state in local `useState` — not Zustand

### TDD Tests

**SelectionToolbar.test.tsx**:
```
1. Does not render when 0 nodes selected
2. Does not render when 1 node selected
3. Renders with count when 2+ nodes selected
4. Shows "3 ideas" text for 3 selected nodes
5. Click "Synthesize" opens popover
6. Escape closes popover
7. aria-label and role="toolbar" present
```

**SynthesisModePopover.test.tsx**:
```
1. Renders four mode buttons (Summarize, Outline, Narrative, Find Gaps)
2. Click Summarize → calls onSelect('summarize')
3. Click Outline → calls onSelect('outline')
4. Click Narrative → calls onSelect('narrative')
5. Click Find Gaps → calls onSelect('questions')
6. Each button shows mode description from synthesisStrings.modeDescriptions
7. Arrow key navigation cycles through modes
8. Enter selects focused mode
9. Escape calls onClose
10. All button labels from synthesisStrings
```

### Tech Debt Checkpoint

- [ ] Components under 100 lines each
- [ ] All CSS uses variables (no hex, no px except 0/1)
- [ ] All strings from `synthesisStrings`
- [ ] React.memo on SelectionToolbar (re-renders only on selection change)
- [ ] No Zustand anti-patterns
- [ ] Keyboard accessible (WCAG 2.1)
- [ ] Zero lint errors

---

## Sub-phase 1F: Synthesis Node Visual Differentiation

### What We Build

A new `colorKey` value `'synthesis'` with distinct visual treatment, plus a "source trace" footer on synthesis nodes. Also extends `IdeaNodeData` with `synthesisSourceIds` and `synthesisMode` fields.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/types/node.ts` | EDIT | +5 lines (add 'synthesis' to NodeColorKey + new data fields + normalizeNodeColorKey update) |
| `src/features/canvas/components/nodes/nodeColorStyles.module.css` | EDIT | +8 lines (synthesis color rules) |
| `src/features/synthesis/components/SynthesisFooter.tsx` | NEW | ~40 |
| `src/features/synthesis/components/SynthesisFooter.module.css` | NEW | ~25 |
| `src/features/canvas/components/nodes/IdeaCard.tsx` | EDIT | +6 lines (conditional render SynthesisFooter) |
| `src/features/synthesis/components/__tests__/SynthesisFooter.test.tsx` | NEW | ~60 |
| `src/styles/variables.css` | EDIT | +3 lines (synthesis color variables) |

### Implementation

**`node.ts`** changes:

```typescript
// 1. Add 'synthesis' to color keys
export const NODE_COLOR_KEYS = ['default', 'danger', 'warning', 'success', 'synthesis'] as const;
export type NodeColorKey = (typeof NODE_COLOR_KEYS)[number];

// 2. normalizeNodeColorKey already handles this — 'synthesis' is now in NODE_COLOR_KEYS
//    so normalizeNodeColorKey('synthesis') → 'synthesis' (no fallback to 'default')

// 3. Extend IdeaNodeData (add optional fields — backward compatible)
interface IdeaNodeData {
  // ... existing fields ...
  synthesisSourceIds?: string[];    // IDs of nodes that were synthesized to create this node
  synthesisMode?: string;           // 'summarize' | 'outline' | 'narrative' | 'questions'
}
```

**`variables.css`** additions:
```css
--node-status-synthesis: oklch(0.75 0.15 260);       /* distinct blue-purple */
--node-status-synthesis-bg: oklch(0.96 0.03 260);
--node-status-synthesis-border: oklch(0.85 0.08 260);
```

**`nodeColorStyles.module.css`** additions (follows existing `data-color` attribute pattern):
```css
.colorContainer[data-color="synthesis"] {
  background: color-mix(in srgb, var(--node-status-synthesis-bg) 60%, var(--color-surface-elevated));
  border-color: var(--node-status-synthesis-border);
}
.colorContainer[data-color="synthesis"]:hover {
  border-color: var(--node-status-synthesis);
}
```

**`SynthesisFooter.tsx`**:
```typescript
interface SynthesisFooterProps {
  readonly sourceCount: number;
  readonly sourceNodeIds: readonly string[];
  readonly onReSynthesize: () => void;
}

export const SynthesisFooter = React.memo(function SynthesisFooter({
  sourceCount, sourceNodeIds, onReSynthesize
}: SynthesisFooterProps) {
  const handleHighlightSources = useCallback(() => {
    const store = useCanvasStore.getState();
    store.clearSelection();
    sourceNodeIds.forEach(id => store.selectNode(id));
  }, [sourceNodeIds]);

  return (
    <div className={styles.footer}>
      <button className={styles.sourceLink} onClick={handleHighlightSources} type="button">
        {synthesisStrings.labels.synthesisOf} {sourceCount} {synthesisStrings.labels.ideas}
      </button>
      <button className={styles.reSynthBtn} onClick={onReSynthesize} type="button"
        aria-label={synthesisStrings.labels.reSynthesize}>
        <RefreshIcon size={12} />
      </button>
    </div>
  );
});
```

**IdeaCard.tsx edit** — conditional mounting of SynthesisFooter (avoids edges subscription for non-synthesis nodes):

```typescript
// In IdeaCard render — only mount footer for synthesis nodes
// SynthesisFooter handles its own edge subscription internally
const isSynthesisNode = nodeColorKey === 'synthesis';

// ... in JSX:
{isSynthesisNode && (
  <SynthesisFooterWrapper nodeId={id} />
)}
```

**`SynthesisFooterWrapper`** (small inline component or extracted):
```typescript
// This component only mounts for synthesis nodes, so the edges subscription
// has ZERO cost for the 95%+ of nodes that are regular IdeaCards.
const SynthesisFooterWrapper = React.memo(function SynthesisFooterWrapper({ nodeId }: { nodeId: string }) {
  const edges = useCanvasStore((s) => s.edges);
  const synthesisSourceIds = useCanvasStore((s) => {
    const node = s.nodes.find(n => n.id === nodeId);
    return node?.data.synthesisSourceIds;
  });
  const { reSynthesize } = useSynthesis();

  const sourceNodeIds = useMemo(
    () => (synthesisSourceIds as string[]) ?? [],
    [synthesisSourceIds]
  );

  const handleReSynthesize = useCallback(() => {
    reSynthesize(nodeId);
  }, [nodeId, reSynthesize]);

  if (sourceNodeIds.length === 0) return null;

  return (
    <SynthesisFooter
      sourceCount={sourceNodeIds.length}
      sourceNodeIds={sourceNodeIds}
      onReSynthesize={handleReSynthesize}
    />
  );
});
```

**Performance rationale**: The previous plan had ALL IdeaCards subscribing to `edges` via `useCanvasStore((s) => s.edges)` to compute `sourceNodeIds`. With 500+ nodes, any edge change would re-render every card. The new approach:
1. Only synthesis nodes mount `SynthesisFooterWrapper`
2. Source IDs are read from `synthesisSourceIds` on the node data (no edge filtering needed)
3. Regular IdeaCards pay zero subscription cost

### TDD Tests

```
1. SynthesisFooter renders "Synthesis of 5 ideas"
2. Click source link → selects source nodes on canvas
3. Click re-synthesize button → calls onReSynthesize
4. IdeaCard with colorKey='synthesis' → renders SynthesisFooterWrapper
5. IdeaCard with colorKey='default' → does NOT render SynthesisFooterWrapper
6. Synthesis color applied via data-color="synthesis" attribute
7. normalizeNodeColorKey('synthesis') → 'synthesis' (not 'default')
8. normalizeNodeColorKey persists 'synthesis' through Firestore round-trip
9. SynthesisFooterWrapper reads sourceNodeIds from node data (not edge filtering)
10. Non-synthesis IdeaCards do NOT subscribe to edges (performance structural test)
```

### Tech Debt Checkpoint

- [ ] SynthesisFooter under 100 lines
- [ ] SynthesisFooterWrapper under 100 lines
- [ ] CSS uses `[data-color="synthesis"]` attribute selector (matches existing pattern)
- [ ] CSS variables for all colors
- [ ] IdeaCard stays under 100 lines after edit (+6 lines from 85 = 91)
- [ ] No closure variables in selectors
- [ ] Non-synthesis IdeaCards pay zero subscription cost
- [ ] Zero lint errors

---

## Sub-phase 1G: KB Token Budget Extension

### What We Build

Add `'synthesis'` as a KB generation type with a reduced token allocation, since synthesis prompts can be very large (20+ nodes of content).

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/knowledgeBank/types/knowledgeBank.ts` | EDIT | +2 lines |
| `src/features/knowledgeBank/types/__tests__/knowledgeBank.test.ts` | EDIT | +5 lines |

### Implementation

**`knowledgeBank.ts`** — extend KB token budgets:

```typescript
export type KBGenerationType = 'single' | 'chain' | 'transform' | 'synthesis';

export const KB_TOKEN_BUDGETS: Record<KBGenerationType, number> = {
  single: 12_000,
  chain: 4_000,
  transform: 3_000,
  synthesis: 3_000,   // Low allocation — synthesis prompt itself is the primary context
};
```

**Rationale**: A 20-node synthesis prompt can consume 20-50K characters. Combined with the 100K system instruction limit in `geminiService.ts`, giving KB its full 12K single budget would risk truncation. The `3_000` budget matches `transform` — minimal reference, since the synthesis prompt already contains all the substantive content.

### TDD Tests

```
1. KB_TOKEN_BUDGETS.synthesis === 3000
2. KBGenerationType accepts 'synthesis' (type-level)
3. getKBContext(prompt, 'synthesis') returns truncated context within budget
```

### Tech Debt Checkpoint

- [ ] Backward compatible (existing types unchanged)
- [ ] Budget value justified in code comment
- [ ] Zero lint errors

---

## Sub-phase 1H: Structural & Integration Tests

### What We Build

Structural tests that prevent regressions, plus an end-to-end integration test for the full synthesis flow.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/synthesis/__tests__/synthesis.structural.test.ts` | NEW | ~70 |
| `src/features/synthesis/__tests__/synthesis.integration.test.ts` | NEW | ~130 |

### Structural Tests

```typescript
describe('Synthesis structural safety', () => {
  test('synthesisPrompts.ts uses only synthesisStrings — no hardcoded strings', ...);
  test('useSynthesis.ts has no bare Zustand destructuring', ...);
  test('useSynthesis.ts has no closure variables in selectors', ...);
  test('SelectionToolbar uses React.memo', ...);
  test('SynthesisFooter uses React.memo', ...);
  test('No any types in synthesis feature', ...);
  test('All synthesis files under 300 lines', ...);
  test('Canvas store setState called at most once in useSynthesis for new synthesis', ...);
  test('Non-synthesis IdeaCards do not import or subscribe to edges for footer', ...);
  test('nodeColorStyles has [data-color="synthesis"] selector', ...);
  test('NODE_COLOR_KEYS includes synthesis', ...);
  test('normalizeNodeColorKey handles synthesis', ...);
});
```

### Integration Test

```typescript
describe('Synthesis end-to-end', () => {
  test('select 3 connected nodes → synthesize(summarize) → creates synthesis node', async () => {
    // Setup: 3 nodes (A→B→C) in canvas store
    // Act: call useSynthesis().synthesize('summarize')
    // Assert:
    //   - Gemini called with prompt containing all 3 headings in topological order
    //   - generateContentWithContext called with (prompt, [], '', kbContext)
    //   - New node created with colorKey='synthesis'
    //   - New node has synthesisSourceIds = [A.id, B.id, C.id]
    //   - New node has synthesisMode = 'summarize'
    //   - Edges connect from root node(s) only, with relationshipType='derived'
    //   - Position is to the right of bounding box, snapped to [16,16] grid
    //   - Heading matches "Synthesis of 3 ideas"
  });

  test('synthesize(questions) → prompt contains questionsInstruction', async () => {
    // Setup: 2 nodes selected
    // Act: synthesize('questions')
    // Assert: prompt sent to Gemini contains questionsInstruction
  });

  test('synthesis with KB context → KB entries included with synthesis budget', async () => {
    // Setup: KB entries enabled, 3 nodes selected
    // Act: synthesize('summarize')
    // Assert: getKBContext called with ('synthesis') generation type
  });

  test('re-synthesis → updates existing node, no new node created', async () => {
    // Setup: existing synthesis node with synthesisSourceIds
    // Act: reSynthesize(synthNode.id)
    // Assert:
    //   - No new node in canvas
    //   - Existing node output updated with new Gemini response
    //   - Heading updated with current source count
  });

  test('re-synthesis after source deletion → works with remaining sources', async () => {
    // Setup: synthesis node with 3 source IDs, delete 1 source
    // Act: reSynthesize(synthNode.id)
    // Assert: graph built from 2 remaining sources, output updated
  });

  test('recursive synthesis: synthesize selection including existing synthesis node', async () => {
    // Setup: synthesis node S + regular nodes D, E selected
    // Act: synthesize('narrative')
    // Assert:
    //   - S.heading and S.output included in prompt as regular content
    //   - New synthesis node created with all 3 IDs in synthesisSourceIds
  });

  test('Gemini error → no node created, error state set', async () => ...);
});
```

### Build Gate Checklist (Full Phase 1)

```bash
npx tsc --noEmit          # zero errors
npm run lint               # zero errors
npm run test               # ALL pass (existing + new)
# File audit:
find src/features/synthesis -name "*.ts*" | xargs wc -l | awk '$1 > 300'  # empty
# String audit:
grep -r "['\"]\w.*\w['\"]" src/features/synthesis/components/ --include="*.tsx" | grep -v import | grep -v strings  # empty
# Zustand audit:
grep -rn "useCanvasStore()" src/features/synthesis/ --include="*.ts*"  # empty (no bare calls)
grep -rn "useSettingsStore()" src/features/synthesis/ --include="*.ts*"  # empty
# Color key audit:
grep -n "synthesis" src/features/canvas/types/node.ts  # present in NODE_COLOR_KEYS
grep -n 'data-color="synthesis"' src/features/canvas/components/nodes/nodeColorStyles.module.css  # present
```

---

## Phase 1 Tech Debt Audit

| Potential Debt | How We Prevented It |
|---------------|-------------------|
| Hardcoded strings in prompts | All strings in `synthesisStrings.ts`, structural test enforces |
| Zustand anti-patterns | All reads via selectors, all actions via `getState()`, structural test enforces |
| Closure variables in selectors | SynthesisFooterWrapper uses stable selectors only, structural test enforces |
| Multiple canvas setState calls | Single atomic update in `useSynthesis`, structural test counts calls |
| Wrong function signatures | Factory functions wrap `createIdeaNode`/`createEdge` with correct signatures; ID generation uses `crypto.randomUUID()` to avoid collision risk in rapid multi-node creation |
| Large files | All files estimated under limits, build gate enforces |
| Missing CSS variables | All CSS uses `--color-*`, `--space-*`, `--radius-*` families |
| Wrong CSS selector pattern | Uses `[data-color="synthesis"]` attribute selector matching existing codebase pattern |
| `any` types | Strict TypeScript, structural test scans |
| Security | No raw user content in system instructions; prompt uses delimited blocks; no URL construction from user input |
| useEffect stale closures | No `useEffect` in synthesis hook — purely callback-driven |
| ReactFlow cascade | Synthesis state in `useReducer`, canvas update is single `setState` |
| Performance: edge subscription | SynthesisFooterWrapper only mounts for synthesis nodes; reads `synthesisSourceIds` from node data, not edge filtering |
| KB token overflow | New `'synthesis'` generation type with 3K budget (prompt itself is primary context) |
| No re-synthesis | `synthesisSourceIds` + `synthesisMode` stored on node; `reSynthesize()` updates in-place |
| normalizeNodeColorKey regression | `'synthesis'` added to `NODE_COLOR_KEYS`; survives Firestore round-trip |
| Toolbar position collision with Phase 4 | Selection-relative positioning (not fixed viewport); falls back gracefully |
| Visual noise from edge spider-web | Edges created from root nodes only, not all selected nodes |

**Net new files**: 17 (9 source + 8 test)
**Files modified**: 6 (strings.ts, node.ts, variables.css, CanvasView.tsx, IdeaCard.tsx, nodeColorStyles.module.css, knowledgeBank.ts)
**Estimated total new lines**: ~1,400 (source + tests)

---

## Changes from Original Plan (Audit Trail)

| # | Issue | Original | Updated |
|---|-------|----------|---------|
| 1 | `createIdeaNode` wrong signature | `createIdeaNode(workspaceId, position, {heading, output})` | New `createSynthesisNode` factory wrapping `createIdeaNode(id, workspaceId, position)` with correct 4-param signature |
| 2 | `createEdge` missing `id` param | `createCanvasEdge(workspaceId, src, tgt, 'derived')` | `createEdge('edge-${crypto.randomUUID()}', workspaceId, src, tgt, 'derived')` |
| 3 | `generateContentWithContext` wrong 2nd arg type | `(prompt, '', '', kbContext)` — string | `(prompt, [], '', kbContext)` — `string[]` array |
| 4 | `getKBContext` called wrong | `await getKBContext('single')` — async, standalone | `getKBContext(prompt, 'synthesis')` — synchronous, from `useKnowledgeBankContext()` hook |
| 5 | CSS selector pattern wrong | `.colorSynthesis { ... }` | `.colorContainer[data-color="synthesis"] { ... }` |
| 6 | `normalizeNodeColorKey` not updated | Not mentioned | `'synthesis'` added to `NODE_COLOR_KEYS` so it survives Firestore round-trips |
| 7 | Architecture says `useAIStore` | "Uses `useAIStore` for generation state" | "Synthesis UI state in local `useReducer`" (matches actual implementation) |
| 8 | Edges from ALL selected nodes | N edges for N selected nodes → spider-web | Edges from ROOT nodes only → clean topology |
| 9 | ALL IdeaCards subscribe to edges | `const edges = useCanvasStore((s) => s.edges)` in every IdeaCard | SynthesisFooterWrapper only mounts for synthesis nodes; reads `synthesisSourceIds` from node data |
| 10 | Grid snap hardcoded | "Snap to grid (16px)" | "Snap to grid using imported `SNAP_GRID` from `canvasViewConstants.ts`" |
| 11 | 3 synthesis modes | Summarize, Outline, Narrative | + **Questions** ("Find Gaps") — BASB Distill alignment |
| 12 | No re-synthesis | One-shot synthesis | `synthesisSourceIds` + `synthesisMode` stored; `reSynthesize()` updates in-place |
| 13 | No KB budget for synthesis | Uses `'single'` (12K tokens) | New `'synthesis'` type (3K tokens) — prompt itself is primary context |
| 14 | Toolbar position: fixed viewport | `position: fixed; bottom; left: 50%` | Selection-relative positioning; avoids Phase 4 ClusterPreviewBar collision |
| 15 | Missing node factory sub-phase | Inline in hook | New Sub-phase 1C: `synthesisNodeFactory.ts` — proper factory with types |
| 16 | No recursive synthesis test | Not mentioned | Explicit test: synthesis node in selection treated as regular content |
