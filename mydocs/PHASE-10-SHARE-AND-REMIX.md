# Phase 10: Share, Remix & Review — Canvas Thinking Goes Outward

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

## Problem Statement

Canvas thinking is currently a private activity. Users build rich spatial knowledge structures but cannot:
1. **Share** their canvas with others (no read-only links, no public views)
2. **Remix** a synthesis — re-synthesize with different node selections to iterate on their thinking
3. **Review** what they've built over time — no activity summary, no "what changed this week"
4. **Quick capture** without opening the full app — no global hotkey or lightweight entry point

These are the four missing pieces that turn ActionStation from a "private thinking tool" into a "thinking-to-output platform" that users return to daily.

## Architecture Decisions (Overall)

- This phase has 4 independent sub-features, each in its own sub-phase
- Sub-features can be built and shipped independently (no dependencies between them)
- Each sub-feature is small enough to fit within existing modules (no new feature modules except `src/features/review/`)

---

## Sub-phase 10A: Shareable Read-Only Canvas Link

### Problem

Users cannot show their canvas to anyone. The only "share" is copying a node to another workspace — same-user only. For BASB's "Express" move, sharing is critical: "Here's my research canvas" or "Here's my project plan."

### Intended Solution

Generate a **read-only snapshot link** that renders a static view of the canvas in the browser. No login required to view. The snapshot is stored in Firebase Storage as a JSON blob with a unique public URL.

### Architecture Decisions

- **Firebase Storage** — snapshot stored as `public-snapshots/{snapshotId}.json`
- **Firebase Storage security rules** — allow public read on `public-snapshots/`, write only for authenticated users
- **Snapshot is frozen** — it captures the canvas at a point in time (not live-synced)
- **Viewer page** — new route `/view/{snapshotId}` that loads the snapshot JSON and renders a read-only ReactFlow canvas
- **Expiry** — snapshots expire after 30 days (Firebase TTL or cleanup function). No indefinite hosting.
- **No editing** — viewer cannot modify, add nodes, or interact with AI. Pan and zoom only.
- **Privacy** — user explicitly clicks "Share canvas" and confirms. No auto-sharing.
- **Analytics**: Add `'canvas_shared'` to `SettingKey` union.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/workspace/services/snapshotService.ts` | NEW | ~55 |
| `src/features/workspace/services/__tests__/snapshotService.test.ts` | NEW | ~60 |
| `src/features/workspace/components/ShareCanvasDialog.tsx` | NEW | ~70 |
| `src/features/workspace/components/ShareCanvasDialog.module.css` | NEW | ~40 |
| `src/features/workspace/components/__tests__/ShareCanvasDialog.test.tsx` | NEW | ~60 |
| `src/app/pages/CanvasViewer.tsx` | NEW | ~80 |
| `src/app/pages/CanvasViewer.module.css` | NEW | ~30 |
| `src/app/router.tsx` | EDIT | Add `/view/:snapshotId` route |
| `src/features/workspace/components/WorkspaceControls.tsx` | EDIT | Add "Share Canvas" button |
| `src/shared/localization/workspaceStrings.ts` | EDIT | Add share strings |

### Implementation

**`snapshotService.ts`** (~55 lines):

```typescript
export async function createSnapshot(
  workspaceId: string,
  workspaceName: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): Promise<string> {
  const snapshotId = crypto.randomUUID();
  const snapshot = {
    id: snapshotId,
    workspaceName,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    nodes: sanitizeNodesForPublic(nodes), // strip internal fields
    edges,
  };

  const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
  const storageRef = ref(storage, `public-snapshots/${snapshotId}.json`);
  await uploadBytes(storageRef, blob);
  const url = await getDownloadURL(storageRef);
  return url;
}

function sanitizeNodesForPublic(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.map((n) => ({
    ...n,
    data: {
      heading: n.data?.heading ?? '',
      output: n.data?.output ?? '',
      tags: n.data?.tags ?? [],
      colorKey: n.data?.colorKey ?? 'default',
      // Strip: attachments, calendarEvent, linkPreviews, isGenerating
    },
  }));
}
```

**`CanvasViewer.tsx`** (~80 lines):
- Fetches snapshot JSON from URL param
- Renders ReactFlow in read-only mode (`nodesDraggable={false}`, `nodesConnectable={false}`)
- Shows workspace name as header, "Created X days ago" subtitle
- No authentication required
- Minimal UI: just the canvas + a "Made with ActionStation" footer link

**ShareCanvasDialog**: Confirmation modal → calls `createSnapshot` → shows copyable URL → copy-to-clipboard button.

### TDD Tests

```
1. createSnapshot uploads JSON to Firebase Storage
2. Snapshot includes workspaceName, createdAt, expiresAt
3. sanitizeNodesForPublic strips attachments and internal fields
4. CanvasViewer renders nodes in read-only mode
5. CanvasViewer shows workspace name
6. ShareCanvasDialog shows URL after creation
7. Copy button copies URL to clipboard
8. Error state shown when snapshot creation fails
9. Viewer gracefully handles invalid/expired snapshot
10. No edit controls visible in viewer
```

### Tech Debt Checkpoint

- [ ] snapshotService under 60 lines
- [ ] CanvasViewer under 85 lines
- [ ] ShareCanvasDialog under 75 lines
- [ ] Read-only mode enforced (no mutation callbacks)
- [ ] Public data sanitized (no internal state leaked)
- [ ] Zero lint errors

---

## Sub-phase 10B: Remix Synthesis

### Problem

Synthesis (Phase 1) is a one-shot operation. Users cannot iterate — they can't say "re-synthesize but include this extra node" or "re-synthesize but exclude that one." Iterative thinking requires iterative synthesis.

### Intended Solution

The synthesis footer (already shows source node IDs) gains two actions:
1. **Re-synthesize** — re-runs synthesis with the same source nodes (refreshes with updated content)
2. **Edit sources** — opens a selection mode where users can add/remove nodes from the source set, then re-synthesize

### Architecture Decisions

- **Extends existing synthesis module** — no new feature module
- **Source IDs stored in synthesis node data** — already exists (`sourceNodeIds` in `IdeaNodeData`)
- **Re-synthesize**: Takes stored `sourceNodeIds`, re-runs `synthesizeNodes()` with current content, replaces synthesis node output
- **Edit sources**: Temporarily highlights source nodes on canvas + enters a selection mode. Users click nodes to add/remove. Confirm triggers re-synthesis with updated set.
- **No new store** — selection state managed in local hook

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/synthesis/hooks/useRemixSynthesis.ts` | NEW | ~60 |
| `src/features/synthesis/hooks/__tests__/useRemixSynthesis.test.ts` | NEW | ~70 |
| `src/features/synthesis/components/SynthesisFooter.tsx` | EDIT | Add Re-synthesize + Edit Sources buttons |
| `src/features/synthesis/components/SourceEditOverlay.tsx` | NEW | ~75 |
| `src/features/synthesis/components/SourceEditOverlay.module.css` | NEW | ~35 |
| `src/features/synthesis/components/__tests__/SourceEditOverlay.test.tsx` | NEW | ~60 |
| `src/features/synthesis/strings/synthesisStrings.ts` | EDIT | Add remix strings |

### Implementation

**`useRemixSynthesis.ts`** (~60 lines):

```typescript
export function useRemixSynthesis(synthesisNodeId: string) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedSourceIds, setEditedSourceIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);

  // Load original source IDs from synthesis node
  const nodes = useCanvasStore((s) => s.nodes);
  const synthesisNode = useMemo(
    () => nodes.find((n) => n.id === synthesisNodeId),
    [nodes, synthesisNodeId]
  );
  const originalSourceIds = synthesisNode?.data?.sourceNodeIds ?? [];

  const startEditSources = useCallback(() => {
    setEditedSourceIds(new Set(originalSourceIds));
    setIsEditing(true);
  }, [originalSourceIds]);

  const toggleSource = useCallback((nodeId: string) => {
    setEditedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const reSynthesize = useCallback(async (sourceIds?: string[]) => {
    const ids = sourceIds ?? originalSourceIds;
    if (ids.length < 2) return;
    setIsProcessing(true);
    try {
      // Reuse existing synthesizeNodes service
      await synthesizeNodes(ids, synthesisNodeId);
    } finally {
      setIsProcessing(false);
      setIsEditing(false);
    }
  }, [originalSourceIds, synthesisNodeId]);

  return {
    isEditing, editedSourceIds, isProcessing,
    startEditSources, toggleSource, cancelEdit: () => setIsEditing(false),
    reSynthesize,
  };
}
```

**SynthesisFooter changes**: Add two icon buttons:
- Refresh icon → calls `reSynthesize()` (same sources, updated content)
- Edit icon → calls `startEditSources()` → shows SourceEditOverlay

**SourceEditOverlay**: When editing sources, highlights source nodes on canvas with a colored border. Non-source nodes are dimmed. Clicking a node toggles it in/out of the set. A floating toolbar shows "Confirm (N sources)" and "Cancel".

### TDD Tests

```
1. reSynthesize calls synthesizeNodes with original source IDs
2. startEditSources initializes editedSourceIds from node data
3. toggleSource adds/removes node IDs
4. reSynthesize with edited IDs uses new set
5. isProcessing true during synthesis
6. cancelEdit resets editing state
7. Cannot re-synthesize with < 2 sources
8. SourceEditOverlay highlights source nodes
9. Clicking dimmed node adds it to sources
10. Clicking highlighted node removes it from sources
```

### Tech Debt Checkpoint

- [ ] useRemixSynthesis under 65 lines
- [ ] SourceEditOverlay under 80 lines
- [ ] Reuses existing synthesizeNodes service (no duplication)
- [ ] SynthesisFooter stays under 100 lines
- [ ] Zero lint errors

---

## Sub-phase 10C: Daily Digest & Activity Review

### Problem

Users have no reason to return daily. There's no "what happened" summary, no reflection prompt, no activity feed. BASB emphasizes **periodic review** as a core habit — but the app doesn't support it.

### Intended Solution

A **Review Panel** accessible from the sidebar that shows:
1. **Activity summary** — nodes created/edited today, this week
2. **Stale nodes** — nodes not touched in 30+ days (candidates for archival or re-engagement)
3. **AI reflection prompt** — "Based on your recent work, consider: [question]" (uses existing Gemini service)
4. **Quick stats** — total nodes, total connections, workspace activity heatmap

### Architecture Decisions

- **New feature module**: `src/features/review/` (types, hooks, components)
- **No new Zustand store** — review data computed from existing canvas/workspace stores
- **Activity tracking**: Derived from `node.createdAt` and `node.updatedAt` timestamps (already stored)
- **AI reflection**: Single Gemini call with recent node headings as context — uses `generateContent()` from existing `geminiService.ts`
- **No server-side aggregation** — all stats computed client-side from node arrays
- **Analytics**: Add `'review_opened'` to `SettingKey`.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/review/types/review.ts` | NEW | ~25 |
| `src/features/review/hooks/useActivitySummary.ts` | NEW | ~55 |
| `src/features/review/hooks/useStalNodes.ts` | NEW | ~30 |
| `src/features/review/hooks/useReflectionPrompt.ts` | NEW | ~40 |
| `src/features/review/components/ReviewPanel.tsx` | NEW | ~85 |
| `src/features/review/components/ReviewPanel.module.css` | NEW | ~50 |
| `src/features/review/components/ActivityCard.tsx` | NEW | ~40 |
| `src/features/review/components/StaleNodesList.tsx` | NEW | ~45 |
| `src/features/review/strings/reviewStrings.ts` | NEW | ~30 |
| `src/features/review/__tests__/useActivitySummary.test.ts` | NEW | ~60 |
| `src/features/review/__tests__/useStalNodes.test.ts` | NEW | ~40 |
| `src/features/review/__tests__/useReflectionPrompt.test.ts` | NEW | ~40 |
| `src/features/review/components/__tests__/ReviewPanel.test.tsx` | NEW | ~60 |
| `src/features/review/index.ts` | NEW | ~5 |
| `src/app/components/Sidebar.tsx` (or equivalent) | EDIT | Add Review panel trigger |
| `src/shared/localization/strings.ts` | EDIT | Import reviewStrings |

### Implementation

**`useActivitySummary.ts`** (~55 lines):

```typescript
export interface ActivitySummary {
  today: { created: number; edited: number };
  thisWeek: { created: number; edited: number };
  total: { nodes: number; connections: number; workspaces: number };
}

export function useActivitySummary(): ActivitySummary {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  return useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const weekStart = startOfWeek(now);

    let todayCreated = 0, todayEdited = 0;
    let weekCreated = 0, weekEdited = 0;

    for (const node of nodes) {
      const created = toDate(node.createdAt);
      const updated = toDate(node.updatedAt);
      if (created >= todayStart) todayCreated++;
      if (created >= weekStart) weekCreated++;
      if (updated >= todayStart && updated > created) todayEdited++;
      if (updated >= weekStart && updated > created) weekEdited++;
    }

    return {
      today: { created: todayCreated, edited: todayEdited },
      thisWeek: { created: weekCreated, edited: weekEdited },
      total: {
        nodes: nodes.length,
        connections: edges.length,
        workspaces: workspaces.filter((w) => w.type !== 'divider').length,
      },
    };
  }, [nodes, edges, workspaces]);
}
```

**`useStaleNodes.ts`** (~30 lines) — returns nodes with `updatedAt` older than 30 days, sorted by staleness.

**`useReflectionPrompt.ts`** (~40 lines):

```typescript
export function useReflectionPrompt() {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const generate = useCallback(async (recentHeadings: string[]) => {
    if (recentHeadings.length === 0) return;
    setIsLoading(true);
    try {
      const context = recentHeadings.join('\n');
      const result = await generateContent(
        reviewStrings.reflectionSystemPrompt,
        `Recent work:\n${context}\n\nSuggest one thought-provoking question.`
      );
      setPrompt(result);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { prompt, isLoading, generate };
}
```

**ReviewPanel**: Sidebar panel with 3 sections:
1. **Activity** — today/week stats in compact cards
2. **Stale Nodes** — list of forgotten nodes with "Go to node" buttons
3. **Reflection** — AI-generated question based on recent work + "Generate" button

### TDD Tests

```
1. useActivitySummary counts today's created nodes
2. useActivitySummary counts this week's edited nodes
3. useActivitySummary total includes all nodes/edges/workspaces
4. useStaleNodes returns nodes older than 30 days
5. useStaleNodes sorts by staleness (oldest first)
6. useStaleNodes excludes recently updated nodes
7. useReflectionPrompt calls generateContent
8. useReflectionPrompt handles API errors gracefully
9. ReviewPanel renders all 3 sections
10. "Go to node" navigates to stale node
```

### Tech Debt Checkpoint

- [ ] useActivitySummary under 60 lines
- [ ] useStaleNodes under 35 lines
- [ ] useReflectionPrompt under 45 lines
- [ ] ReviewPanel under 90 lines
- [ ] All strings from reviewStrings
- [ ] Reuses existing generateContent (no service duplication)
- [ ] Zero lint errors

---

## Sub-phase 10D: Quick Capture Entry Point

### Problem

To add a thought, users must: open the app → navigate to a workspace → click "Add Node" → type. For BASB, capture should be frictionless — "I had an idea in the shower, let me jot it down." A lightweight entry point reduces capture friction.

### Intended Solution

A **Quick Capture panel** — a minimal overlay triggered by a keyboard shortcut (`Ctrl+Shift+N` or configurable) that shows just a text input and a workspace selector. Type → select workspace → press Enter → node created in background. No full canvas needed.

### Architecture Decisions

- **Part of existing canvas module** — small addition, not a new feature module
- **Global keyboard shortcut** — registered at app level, works from any page
- **Minimal UI** — floating panel (not a full modal): text input + workspace dropdown + submit button
- **Creates node via existing `addNode`** — no new store actions
- **Dismiss on Escape or submit** — standard interaction
- **Works even if canvas is not loaded** — creates node in store, autosave picks it up

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/components/QuickCapture.tsx` | NEW | ~75 |
| `src/features/canvas/components/QuickCapture.module.css` | NEW | ~40 |
| `src/features/canvas/components/__tests__/QuickCapture.test.tsx` | NEW | ~70 |
| `src/features/canvas/hooks/useQuickCapture.ts` | NEW | ~45 |
| `src/features/canvas/hooks/__tests__/useQuickCapture.test.ts` | NEW | ~50 |
| `src/app/App.tsx` | EDIT | Mount QuickCapture + register global shortcut |
| `src/shared/localization/canvasStrings.ts` | EDIT | Add quick capture strings |

### Implementation

**`useQuickCapture.ts`** (~45 lines):

```typescript
export function useQuickCapture() {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState('');
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string | null>(null);

  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const open = useCallback(() => {
    setTargetWorkspaceId(currentWorkspaceId);
    setIsOpen(true);
  }, [currentWorkspaceId]);

  const submit = useCallback(() => {
    if (!text.trim() || !targetWorkspaceId) return;

    const node: CanvasNode = {
      id: `idea-${crypto.randomUUID()}`,
      type: 'idea',
      position: { x: 32, y: 32 }, // default position, arrange later
      workspaceId: targetWorkspaceId,
      createdAt: new Date(),
      updatedAt: new Date(),
      data: { heading: text.trim(), output: '', tags: [], colorKey: 'default',
              width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT },
    };

    useCanvasStore.getState().addNode(node);
    toast.success(canvasStrings.quickCapture.saved);
    setText('');
    setIsOpen(false);
  }, [text, targetWorkspaceId]);

  const close = useCallback(() => {
    setText('');
    setIsOpen(false);
  }, []);

  return { isOpen, text, targetWorkspaceId, workspaces, open, close, setText, setTargetWorkspaceId, submit };
}
```

**QuickCapture panel**: Floating panel (fixed position, center-top of screen):
- Auto-focus text input on open
- Workspace selector (dropdown of non-divider workspaces)
- Submit on Enter, dismiss on Escape
- Toast confirmation on save

**Global shortcut**: `Ctrl+Shift+N` (or `Cmd+Shift+N` on Mac) registered in App.tsx keydown handler.

### TDD Tests

```
1. open() sets isOpen to true
2. open() defaults targetWorkspaceId to current workspace
3. submit() creates node with heading from text
4. submit() uses crypto.randomUUID() for node ID
5. submit() clears text and closes panel
6. submit() shows success toast
7. submit() is no-op with empty text
8. close() clears text and closes
9. Ctrl+Shift+N opens quick capture
10. Escape closes quick capture
11. Enter submits
12. Workspace selector changes target workspace
```

### Tech Debt Checkpoint

- [ ] QuickCapture under 80 lines
- [ ] useQuickCapture under 50 lines
- [ ] crypto.randomUUID() for IDs
- [ ] Toast strings from resources
- [ ] Global shortcut doesn't conflict with existing bindings
- [ ] Zero lint errors

---

## Phase 10 Summary

### Execution Order (Independent — any order works)

| Phase | What | Dependency |
|-------|------|------------|
| 10A | Shareable read-only links | Firebase Storage setup |
| 10B | Remix synthesis | Phase 1 synthesis complete |
| 10C | Daily digest / review | None |
| 10D | Quick capture | None |

### Net Impact

- **Files created**: ~45 (across 4 sub-features)
- **Files edited**: ~8
- **Net line count change**: ~+1,800 lines
- **New feature modules**: 1 (`src/features/review/`)

### User Impact by Sub-feature

| Feature | User Value | Retention Impact |
|---------|-----------|-----------------|
| **Share links** | "Look at my research canvas" — Express to others | High — sharing creates social validation |
| **Remix synthesis** | Iterate on AI synthesis with different node sets | Medium — power users love iteration |
| **Daily review** | "What did I work on? What's stale?" — builds daily habit | High — brings users back |
| **Quick capture** | Ctrl+Shift+N → type → done — zero friction capture | High — BASB's #1 habit |

### What's NOT Included

| Item | Reason |
|------|--------|
| Real-time collaborative editing | Major infrastructure (CRDT/OT), separate initiative |
| Email digest notifications | Requires server-side email service, out of scope |
| Native system-wide hotkey | Requires Electron/Tauri wrapper, web-only for now |
| Snapshot editing/updating | Snapshots are frozen by design — create a new one |
| Template sharing (public templates) | Phase 9 is personal only; public marketplace is future |
