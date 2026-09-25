# Phase 6: Canvas Undo/Redo — Fearless Thinking

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

## Problem Statement

Deleting a node is permanent. Moving a node can't be reversed. Disconnecting an edge is gone forever. TipTap provides text-level undo within a single node editor, but there is **zero canvas-level undo/redo**. For a thinking tool where users experiment freely — drag-clustering ideas, pruning dead branches, reorganizing spatial relationships — this creates anxiety. Users hesitate to delete, move, or restructure because mistakes are irreversible. The canvas should feel like a safe playground for thinking, not a minefield where one wrong click destroys work.

## Intended Solution

A lightweight command history stack, **completely isolated from the canvas store**, that captures reversible operations. Users press `Ctrl+Z` to undo and `Ctrl+Shift+Z` / `Ctrl+Y` to redo. Undo/redo buttons in the bottom-left canvas controls provide visual discoverability and mobile access. The stack stores **inverse operation closures** (command pattern), not full canvas snapshots, keeping memory usage minimal even with 500+ nodes.

## Architecture Decisions

### Isolation: Separate History Store (NOT a canvas store slice)

The history stack lives in its own `useHistoryStore`, **completely isolated** from `useCanvasStore`. This prevents Zustand subscription cascades — subscribing to `canUndo`/`canRedo` in undo/redo buttons **never** triggers re-renders of canvas nodes, edges, or ReactFlow internals.

**Dispatch pattern**: A **pure reducer** (`historyReducer.ts`) handles all state transitions. The Zustand store wraps it with a `dispatch()` method that calls the reducer and applies the result in a **single `set(newState)` call** — a clean one-shot atomic update, identical to React's `useReducer` semantics but accessible imperatively via `getState()`.

```
┌─────────────────────────────────────────────────────────┐
│  useHistoryStore (isolated Zustand store)                │
│  ┌────────────────────────────────────────────────────┐  │
│  │  historyReducer (pure function)                    │  │
│  │  dispatch(action) → reducer(state, action) → set() │  │
│  └────────────────────────────────────────────────────┘  │
│  State: undoStack[], redoStack[]                         │
│  Derived: canUndo, canRedo (selectors, not stored)       │
└──────────────────────┬──────────────────────────────────┘
                       │ undo/redo closures call:
                       ▼
┌──────────────────────────────────────────────────────────┐
│  useCanvasStore.getState().someAction()                   │
│  (imperative — no subscription, no cascade)               │
└──────────────────────────────────────────────────────────┘
```

### Summary of Key Decisions

- **Separate Zustand store** — `useHistoryStore` is NOT a slice of `useCanvasStore`. Zero cascade risk.
- **Pure reducer** — `historyReducer` is a testable pure function. The store's `dispatch()` calls it and applies the result in one `set()`.
- **Derived selectors, not stored booleans** — `canUndo`/`canRedo` are derived via `(s) => s.undoStack.length > 0`, not separate boolean fields. No sync bugs.
- **Command pattern** — each undoable action records `{ type, undo: () => void, redo: () => void }`. No full-state cloning.
- **Stack depth**: 50 operations max (ring buffer). Beyond 50, oldest entries are discarded.
- **Batching**: Drag operations (continuous position updates) are batched — only the start and end positions are recorded as one entry.
- **Not persisted**: History resets on workspace switch and page reload. This is intentional — undo is a session tool, not a time machine.
- **Scope**: Structural mutations (add/delete/move node, add/delete edge, color change, AI transforms) are undoable. Text editing undo stays in TipTap.
- **AI Transform undo**: Included — transforms overwrite node content, which is destructive. Ctrl+Z to restore pre-transform text is the natural expectation.
- **ID generation**: N/A — undo restores existing IDs, doesn't create new ones.
- **Atomic Operations & Coalescing**: Commands are grouped to support multi-selection (batch deletion/moves). Rapid, identical actions (like scrubbing through colors) are coalesced into a single history entry to prevent stack pollution.
- **Z-Index Conservation**: Nodes are restored to their original array index to perfectly maintain rendering order.
- **Orphan Guarding**: Restored edges defensively check for existing source/target nodes to prevent ReactFlow crashes.
- **UI Buttons**: Undo/Redo buttons in `ZoomControls` (bottom-left, alongside zoom + lock) — visual discoverability + mobile access.
- **Analytics**: Add `'canvas_undo'` and `'canvas_redo'` to `SettingKey` union in `analyticsService.ts`.

### Security Considerations

- `structuredClone()` is used for deep-copying node/edge state — safe, no code execution.
- Command closures capture frozen snapshots, not live references — no stale data mutation.
- `insertNodeAtIndex` clamps the index to `[0, nodes.length]` — no out-of-bounds injection.
- No user input is passed unsanitized into closures — all IDs come from existing store state.
- History stack is session-only, never persisted — no Firestore injection surface.

---

## Sub-phase 6A: History Reducer + Types + Store

### What We Build

The isolated history infrastructure: typed command definitions, a pure reducer for all state transitions, and a tiny Zustand store that wraps it with one-shot dispatch.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/types/history.ts` | NEW | ~40 |
| `src/features/canvas/stores/historyReducer.ts` | NEW | ~65 |
| `src/features/canvas/stores/historyStore.ts` | NEW | ~40 |
| `src/features/canvas/stores/__tests__/historyReducer.test.ts` | NEW | ~120 |
| `src/features/canvas/stores/__tests__/historyStore.test.ts` | NEW | ~60 |

### Implementation

**`history.ts`** (~40 lines) — Types only, zero runtime:

```typescript
export const MAX_HISTORY_DEPTH = 50;

export type CanvasCommandType =
  | 'addNode'
  | 'deleteNode'
  | 'batchDelete'
  | 'moveNode'
  | 'addEdge'
  | 'deleteEdge'
  | 'changeColor'
  | 'transformContent';
// NOTE: batchMove, togglePin, toggleCollapse removed per review.
// batchMove: multi-node drag not yet implemented.
// togglePin/toggleCollapse: self-inverse toggles — calling the same action reverses them, no undo needed.

export interface CanvasCommand {
  readonly type: CanvasCommandType;
  readonly timestamp: number;
  readonly entityId?: string;  // For coalescing rapid sequential actions (e.g. color scrubbing)
  readonly label?: string;     // Human-readable label for toast (from string resources)
  readonly undo: () => void;
  readonly redo: () => void;
}

export type HistoryAction =
  | { type: 'PUSH'; command: CanvasCommand }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'CLEAR' };

export interface HistoryState {
  readonly undoStack: readonly CanvasCommand[];
  readonly redoStack: readonly CanvasCommand[];
}

export const INITIAL_HISTORY_STATE: HistoryState = {
  undoStack: [],
  redoStack: [],
};
```

**`historyReducer.ts`** (~65 lines) — Pure function, zero dependencies on Zustand/React:

```typescript
import {
  MAX_HISTORY_DEPTH,
  INITIAL_HISTORY_STATE,
  type HistoryState,
  type HistoryAction,
  type CanvasCommand,
} from '../types/history';

const COALESCE_WINDOW_MS = 1000;

function isCoalescable(last: CanvasCommand, next: CanvasCommand): boolean {
  return (
    !!next.entityId &&
    last.entityId === next.entityId &&
    last.type === next.type &&
    next.timestamp - last.timestamp < COALESCE_WINDOW_MS
  );
}

function pushCommand(state: HistoryState, command: CanvasCommand): HistoryState {
  const stack = [...state.undoStack];
  const last = stack[stack.length - 1];

  if (last && isCoalescable(last, command)) {
    // Keep original undo, update redo to latest
    stack[stack.length - 1] = { ...last, redo: command.redo, timestamp: command.timestamp };
  } else {
    stack.push(command);
    if (stack.length > MAX_HISTORY_DEPTH) stack.shift();
  }

  return { undoStack: stack, redoStack: [] };
}

// NOTE: undo()/redo() side effects are NOT called here — the reducer stays truly pure.
// The store's dispatch() method calls cmd.undo()/cmd.redo() BEFORE applying the reducer.
function undoCommand(state: HistoryState): HistoryState {
  if (state.undoStack.length === 0) return state;
  const cmd = state.undoStack[state.undoStack.length - 1];
  return {
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, cmd],
  };
}

function redoCommand(state: HistoryState): HistoryState {
  if (state.redoStack.length === 0) return state;
  const cmd = state.redoStack[state.redoStack.length - 1];
  return {
    undoStack: [...state.undoStack, cmd],
    redoStack: state.redoStack.slice(0, -1),
  };
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'PUSH':  return pushCommand(state, action.command);
    case 'UNDO':  return undoCommand(state);
    case 'REDO':  return redoCommand(state);
    case 'CLEAR': return INITIAL_HISTORY_STATE;
    default:      return state;
  }
}
```

**`historyStore.ts`** (~40 lines) — Thin Zustand wrapper with one-shot dispatch:

```typescript
import { create } from 'zustand';
import { historyReducer } from './historyReducer';
import { INITIAL_HISTORY_STATE, type HistoryState, type HistoryAction } from '../types/history';

interface HistoryStore extends HistoryState {
  /** One-shot dispatch: reducer(state, action) → set(newState) */
  dispatch: (action: HistoryAction) => void;
}

export const useHistoryStore = create<HistoryStore>()((set, get) => ({
  ...INITIAL_HISTORY_STATE,

  dispatch: (action: HistoryAction) => {
    // Execute side effects OUTSIDE the reducer (keeps reducer truly pure)
    if (action.type === 'UNDO') {
      const cmd = get().undoStack.at(-1);
      cmd?.undo();
    }
    if (action.type === 'REDO') {
      const cmd = get().redoStack.at(-1);
      cmd?.redo();
    }
    const currentState: HistoryState = {
      undoStack: get().undoStack,
      redoStack: get().redoStack,
    };
    const newState = historyReducer(currentState, action);
    set(newState); // ONE-SHOT atomic update — no cascading
  },
}));
```

### Why Derived Selectors (Not Stored Booleans)

`canUndo` and `canRedo` are **not stored as separate fields**. They are derived at the consumption site:

```typescript
// ✅ CORRECT — derived, always in sync, zero maintenance
const canUndo = useHistoryStore((s) => s.undoStack.length > 0);
const canRedo = useHistoryStore((s) => s.redoStack.length > 0);

// ❌ WRONG — stored booleans can drift out of sync with stacks
// canUndo: boolean;
// canRedo: boolean;
```

This eliminates an entire class of bugs where flags and stacks disagree.

### TDD Tests

**`historyReducer.test.ts`** (~120 lines) — Pure function tests (no React/Zustand needed):

```
1.  PUSH adds command to undoStack
2.  PUSH clears redoStack
3.  PUSH coalesces rapid same-entity, same-type commands (< 1000ms)
4.  PUSH does NOT coalesce different entity IDs
5.  PUSH does NOT coalesce different command types
6.  PUSH does NOT coalesce if > 1000ms apart
7.  PUSH coalescing preserves original undo, updates redo
8.  PUSH respects MAX_HISTORY_DEPTH (oldest discarded via shift)
9.  UNDO pops from undoStack, pushes to redoStack
10. UNDO does NOT call cmd.undo() (side effects live in store dispatch, not reducer)
11. UNDO on empty stack returns same state (referential equality)
12. REDO pops from redoStack, pushes to undoStack
13. REDO does NOT call cmd.redo() (side effects live in store dispatch, not reducer)
14. REDO on empty stack returns same state (referential equality)
15. CLEAR returns INITIAL_HISTORY_STATE
16. Unknown action type returns same state
```

**`historyStore.test.ts`** (~60 lines) — Integration with Zustand:

```
1. dispatch(PUSH) updates undoStack in store
2. dispatch(UNDO) moves command from undo to redo
3. dispatch(UNDO) calls cmd.undo() side effect (in dispatch, not reducer)
4. dispatch(REDO) moves command from redo to undo
5. dispatch(REDO) calls cmd.redo() side effect (in dispatch, not reducer)
6. dispatch(CLEAR) resets both stacks
7. One-shot: dispatch triggers exactly one set() call (spy on set)
8. Selector (s) => s.undoStack.length > 0 returns correct canUndo
```

### Tech Debt Audit (6A)

| Check | Status |
|-------|--------|
| `history.ts` under 40 lines | Verify |
| `historyReducer.ts` under 70 lines | Verify |
| `historyStore.ts` under 45 lines | Verify |
| All strings from resources (N/A — no UI in this phase) | N/A |
| Zero lint errors | `npm run lint` |
| All tests pass | `npm run test` |
| Build succeeds | `npm run build` |
| No Zustand anti-patterns (no bare destructuring of historyStore) | Code review |
| No `any` types | Code review |
| Reducer is genuinely pure (side effects in dispatch, not reducer) | Code review |

**Debt incurred**: None. This phase is pure infrastructure with no UI, no shortcuts, no integration points. Types, reducer, and store are self-contained.

---

## Sub-phase 6B: Undoable Action Wrappers + insertNodeAtIndex

### What We Build

1. A new `insertNodeAtIndex` helper + canvas store action (for Z-index–preserving undo).
2. `useUndoableActions` hook that wraps canvas actions and dispatches commands to the isolated history store.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/stores/canvasStoreHelpers.ts` | EDIT | Add `insertNodeAtIndexInArray` (~8 lines) |
| `src/features/canvas/stores/canvasStoreActions.ts` | EDIT | Add `insertNodeAtIndex` action to `createNodeMutationActions` (~2 lines) |
| `src/features/canvas/stores/canvasStore.ts` | EDIT | Add `insertNodeAtIndex` to `CanvasActions` interface (~1 line) |
| `src/features/canvas/hooks/useUndoableActions.ts` | NEW | ~75 |
| `src/features/canvas/hooks/__tests__/useUndoableActions.test.ts` | NEW | ~120 |
| `src/shared/localization/canvasStrings.ts` | EDIT | Add undo/redo label strings (~8 lines) |

### Implementation

**`canvasStoreHelpers.ts`** — Add helper (append ~8 lines):

```typescript
/**
 * Inserts a node at a specific array index (Z-index restoration for undo).
 * Clamps index to valid range — no out-of-bounds risk.
 */
export function insertNodeAtIndexInArray(
    nodes: CanvasNode[],
    node: CanvasNode,
    index: number
): CanvasNode[] {
    const clamped = Math.max(0, Math.min(index, nodes.length));
    const result = [...nodes];
    result.splice(clamped, 0, node);
    return result;
}
```

**`canvasStoreActions.ts`** — Add action to `createNodeMutationActions` (append ~2 lines):

```typescript
insertNodeAtIndex: (node: CanvasNode, index: number) =>
    set((s) => ({ nodes: insertNodeAtIndexInArray(s.nodes, node, index) })),
```

**`canvasStore.ts`** — Add to `CanvasActions` interface (append ~1 line):

```typescript
insertNodeAtIndex: (node: CanvasNode, index: number) => void;
```

**`canvasStrings.ts`** — Add undo/redo label strings:

```typescript
history: {
    undoDelete: 'Undo delete',
    undoBatchDelete: (count: number) => `Undo delete (${count} nodes)`,
    undoAdd: 'Undo add',
    undoMove: 'Undo move',
    undoEdge: 'Undo edge change',
    undoColor: 'Undo color change',
    undoTransform: 'Undo transform',
    redoAction: 'Redo',
    nothingToUndo: 'Nothing to undo',
    nothingToRedo: 'Nothing to redo',
},
```

**`useUndoableActions.ts`** (~75 lines) — The bridge between UI actions and the isolated history store:

```typescript
import { useCallback } from 'react';
import { useCanvasStore, getNodeMap } from '../stores/canvasStore';
import { useHistoryStore } from '../stores/historyStore';
import type { CanvasNode } from '../types/node';
import type { CanvasEdge } from '../types/edge';
import type { CanvasCommandType } from '../types/history';

/** Dispatch a command to the isolated history store */
function pushCmd(type: CanvasCommandType, undo: () => void, redo: () => void, entityId?: string) {
  useHistoryStore.getState().dispatch({
    type: 'PUSH',
    command: { type, timestamp: Date.now(), undo, redo, entityId },
  });
}

/** Higher-order helper: push command then execute — eliminates boilerplate (Fix #8) */
function withUndo(type: CanvasCommandType, execute: () => void, reverse: () => void, entityId?: string) {
  pushCmd(type, reverse, execute, entityId);
  execute();
}

export function useUndoableActions() {
  const deleteNodeWithUndo = useCallback((nodeIds: string[], edgeIds: string[] = []) => {
    const state = useCanvasStore.getState();
    const nodeMap = getNodeMap(state.nodes);

    // Freeze nodes with Z-index
    const frozen = nodeIds
      .map((id) => ({ node: nodeMap.get(id), index: state.nodes.findIndex((n) => n.id === id) }))
      .filter((e): e is { node: CanvasNode; index: number } => e.node != null)
      .map(({ node, index }) => ({ node: structuredClone(node), index }));

    // Freeze connected edges
    const affectedEdgeIds = new Set(edgeIds);
    state.edges.forEach((e) => {
      if (nodeIds.includes(e.sourceNodeId) || nodeIds.includes(e.targetNodeId)) affectedEdgeIds.add(e.id);
    });
    const frozenEdges: CanvasEdge[] = structuredClone(
      state.edges.filter((e) => affectedEdgeIds.has(e.id))
    );

    const cmdType: CanvasCommandType = nodeIds.length > 1 ? 'batchDelete' : 'deleteNode';
    withUndo(cmdType, () => {
      // EXECUTE / REDO: delete nodes
      nodeIds.forEach((id) => useCanvasStore.getState().deleteNode(id));
    }, () => {
      // UNDO: restore nodes at original Z-index, then restore orphan-guarded edges
      // Fix #3: Fresh getState() after each mutation to avoid stale references
      frozen.sort((a, b) => a.index - b.index).forEach(({ node, index }) => {
        useCanvasStore.getState().insertNodeAtIndex(node, index);
      });
      const currentNodeIds = new Set(useCanvasStore.getState().nodes.map((n) => n.id));
      frozenEdges.forEach((e) => {
        if (currentNodeIds.has(e.sourceNodeId) && currentNodeIds.has(e.targetNodeId)) {
          useCanvasStore.getState().addEdge(e);
        }
      });
    });
  }, []);

  const addNodeWithUndo = useCallback((node: CanvasNode) => {
    withUndo('addNode', () => {
      useCanvasStore.getState().addNode(structuredClone(node));
    }, () => {
      useCanvasStore.getState().deleteNode(node.id);
    });
  }, []);

  // Additional wrappers follow same pattern using withUndo()...
  return { deleteNodeWithUndo, addNodeWithUndo };
}
```

**Key design decisions:**
- `structuredClone` captures node state at action time (not a reference).
- Connected edges are restored alongside the node (atomic undo).
- Orphan guard: edges only restored if both source and target nodes exist.
- Z-index conservation: `insertNodeAtIndex` with clamped index.
- `batchDelete` vs `deleteNode` type enables correct toast messages.
- All `getState()` calls — no Zustand subscriptions in callbacks, no closure stale-reference risk.
- History dispatches go to `useHistoryStore`, NOT `useCanvasStore` — complete isolation.

### TDD Tests

**`useUndoableActions.test.ts`** (~120 lines):

```
Unit Tests:
1.  deleteNodeWithUndo removes node AND dispatches PUSH to historyStore
2.  deleteNodeWithUndo captures connected edges in frozen snapshot
3.  Undo after deleteNode restores node at original array index
4.  Undo after deleteNode restores connected edges (orphan-guarded)
5.  Redo after undo re-deletes the node
6.  addNodeWithUndo adds node AND dispatches PUSH to historyStore
7.  Undo after addNode removes the node
8.  batchDelete (multiple nodeIds) uses 'batchDelete' command type

Integration Tests:
9.  Full round-trip: add → delete → undo → verify node exists at correct index
10. Full round-trip: delete node with 2 edges → undo → verify node + both edges restored
11. Orphan guard: delete nodeA → delete nodeB (connected) → undo nodeB → edge NOT restored (nodeA still gone)
```

### Tech Debt Audit (6B)

| Check | Status |
|-------|--------|
| `useUndoableActions.ts` under 75 lines | Verify |
| `canvasStoreHelpers.ts` stays under 300 lines (~258 + 8 = ~266) | Verify |
| `canvasStoreActions.ts` stays under 300 lines (~241 + 2 = ~243) | Verify |
| `canvasStore.ts` stays under 130 lines (~123 + 1 = ~124) | Verify |
| `canvasStrings.ts` stays under 60 lines (~48 + 8 = ~56) | Verify |
| All strings from resources (undo labels) | Code review |
| No `structuredClone` on every render (only on mutation) | Code review |
| No Zustand anti-patterns (all `getState()` in callbacks) | Code review |
| No closure variables in selectors | Code review |
| No `any` types | Code review |
| Zero lint errors | `npm run lint` |
| All tests pass | `npm run test` |
| Build succeeds | `npm run build` |

**Debt incurred**: None. Helper is pure, action follows existing factory pattern, hook follows established `getState()` convention.

---

## Sub-phase 6C: Keyboard Binding + Drag Batching + AI Transform Undo

### What We Build

1. Wire `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` into the existing `useKeyboardShortcuts.ts` hook.
2. `useDragBatch.ts` — batch drag operations into single undo entries.
3. AI transform undo support (capture pre-transform content, push command).
4. Update `KeyboardSection.tsx` with new shortcut display.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/app/hooks/useKeyboardShortcuts.ts` | EDIT | Add undo/redo to `handleModifierShortcuts` (~15 lines) |
| `src/features/canvas/hooks/useDragBatch.ts` | NEW | ~40 |
| `src/features/canvas/hooks/__tests__/useDragBatch.test.ts` | NEW | ~70 |
| `src/features/canvas/components/CanvasView.tsx` | EDIT | Wire `useDragBatch` handlers into `<ReactFlow>` `onNodeDragStart`/`onNodeDragStop` (~5 lines) |
| `src/features/ai/hooks/useNodeTransformation.ts` | EDIT | Capture pre-transform snapshot, push `transformContent` command after AI completes (~12 lines) |
| `src/app/components/SettingsPanel/sections/KeyboardSection.tsx` | EDIT | Add 2 shortcut entries (~2 lines) |
| `src/shared/localization/canvasStrings.ts` | EDIT | Verify all toast strings present |

### Implementation

**`useKeyboardShortcuts.ts`** — Add to `handleModifierShortcuts` function:

```typescript
// Undo: Ctrl+Z / Cmd+Z (skip if editing text)
if (e.key === 'z' && !e.shiftKey) {
    if (isEditableTarget(e)) return false; // Let TipTap handle its own undo
    e.preventDefault();
    e.stopImmediatePropagation();
    useHistoryStore.getState().dispatch({ type: 'UNDO' });
    return true;
}

// Redo: Ctrl+Shift+Z / Cmd+Shift+Z
if (e.key === 'z' && e.shiftKey) {
    if (isEditableTarget(e)) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    useHistoryStore.getState().dispatch({ type: 'REDO' });
    return true;
}

// Redo: Ctrl+Y (Windows convention)
if (e.key === 'y') {
    if (isEditableTarget(e)) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    useHistoryStore.getState().dispatch({ type: 'REDO' });
    return true;
}
```

**Critical: `isEditableTarget` guard** — The existing `domGuards.ts:isEditableTarget()` already checks for `INPUT`, `TEXTAREA`, and `contentEditable`. This ensures:
- TipTap editors keep their own Ctrl+Z (text undo)
- Canvas undo only fires when no text input is focused
- No conflict between text-level and canvas-level undo

**Note:** This adds ~15 lines to `useKeyboardShortcuts.ts` (99 → ~114 lines, well under 300).

**`useDragBatch.ts`** (~40 lines):

```typescript
import { useRef, useCallback } from 'react';
import type { NodeDragHandler } from '@xyflow/react';
import { useCanvasStore, getNodeMap } from '../stores/canvasStore';
import { useHistoryStore } from '../stores/historyStore';
import type { NodePosition } from '../types/node';

interface DragSnapshot {
  nodeId: string;
  startPosition: NodePosition;
}

export function useDragBatch() {
  const snapshotRef = useRef<DragSnapshot | null>(null);

  const onNodeDragStart: NodeDragHandler = useCallback((_event, node) => {
    snapshotRef.current = {
      nodeId: node.id,
      startPosition: structuredClone(node.position),
    };
  }, []);

  const onNodeDragStop: NodeDragHandler = useCallback((_event, node) => {
    const snapshot = snapshotRef.current;
    if (!snapshot || snapshot.nodeId !== node.id) return;
    snapshotRef.current = null;

    const startPos = snapshot.startPosition;
    const endPos = structuredClone(node.position);

    // Skip if node didn't actually move (click without drag)
    if (startPos.x === endPos.x && startPos.y === endPos.y) return;

    const nodeId = node.id;
    useHistoryStore.getState().dispatch({
      type: 'PUSH',
      command: {
        type: 'moveNode',
        timestamp: Date.now(),
        entityId: nodeId,
        undo: () => {
          const nodes = useCanvasStore.getState().nodes;
          const target = getNodeMap(nodes).get(nodeId);
          if (target) {
            useCanvasStore.getState().setNodes(
              nodes.map((n) => n.id === nodeId ? { ...n, position: startPos } : n)
            );
          }
        },
        redo: () => {
          const nodes = useCanvasStore.getState().nodes;
          useCanvasStore.getState().setNodes(
            nodes.map((n) => n.id === nodeId ? { ...n, position: endPos } : n)
          );
        },
      },
    });
  }, []);

  return { onNodeDragStart, onNodeDragStop };
}
```

**`CanvasView.tsx`** — Wire `useDragBatch` into the `<ReactFlow>` component (Fix #2):

The existing `CanvasView.tsx` currently only handles `onNodeDragStop` via `commitDragOverrides`. We need to:
1. Import and call `useDragBatch()` to get `onNodeDragStart` and `onNodeDragStop` handlers.
2. Compose `useDragBatch.onNodeDragStop` with the existing `commitDragOverrides` so both fire on drag end.
3. Pass `useDragBatch.onNodeDragStart` as `onNodeDragStart` prop on `<ReactFlow>`.

```typescript
// In CanvasViewInner:
const { onNodeDragStart: historyDragStart, onNodeDragStop: historyDragStop } = useDragBatch();

const handleNodeDragStop: NodeDragHandler = useCallback(
    (event, node, nodes) => {
        commitDragOverrides();
        historyDragStop(event, node, nodes);
    },
    [commitDragOverrides, historyDragStop],
);

// On <ReactFlow>:
//   onNodeDragStart={historyDragStart}
//   onNodeDragStop={handleNodeDragStop}
```

**`useNodeTransformation.ts`** — Wire AI transform undo (Fix #6):

This is the specific file where `transformContent` is called. The pattern:
1. Capture `node.data.output` via `structuredClone` BEFORE the transform call.
2. After `updateNodeOutput` succeeds, push a `transformContent` command with the pre/post snapshots.

Note: `generateBranchNode` (if it exists) creates a NEW node+edge — that's an `addNode` undo handled by `addNodeWithUndo`, not a `transformContent` undo.

**`KeyboardSection.tsx`** — Add two entries to SHORTCUTS array:

```typescript
{ action: strings.shortcuts.undo, keys: formatShortcut('Z') },
{ action: strings.shortcuts.redo, keys: formatShortcut('Shift + Z') },
```

**AI Transform undo** — The wiring point is wherever `transformContent` is called in the AI service layer. The pattern:

```typescript
// In the component/hook that calls transform:
const preTransformOutput = structuredClone(node.data.output);
const preTransformHeading = structuredClone(node.data.heading);

// After transform completes successfully:
pushCmd('transformContent', () => {
  // UNDO: restore pre-transform content
  const s = useCanvasStore.getState();
  if (preTransformOutput !== undefined) s.updateNodeOutput(nodeId, preTransformOutput);
  if (preTransformHeading !== undefined) s.updateNodeHeading(nodeId, preTransformHeading);
}, () => {
  // REDO: re-apply transformed content (captured after AI completes)
  const s = useCanvasStore.getState();
  s.updateNodeOutput(nodeId, transformedOutput);
  s.updateNodeHeading(nodeId, transformedHeading);
}, nodeId);
```

### TDD Tests

**`useDragBatch.test.ts`** (~70 lines):

```
Unit Tests:
1. onNodeDragStart captures node position in ref
2. onNodeDragStop dispatches PUSH with moveNode command
3. Undo after drag restores original position
4. Redo after undo restores dragged position
5. No-op when node position unchanged (click without drag)
6. Multiple drags create separate undo entries (not batched across drags)

Integration Tests:
7. Drag node → Ctrl+Z → node returns to start position
8. Drag node → Ctrl+Z → Ctrl+Shift+Z → node at dragged position
```

**Keyboard shortcut tests** (added to existing `useKeyboardShortcuts.test.ts`):

```
9.  Ctrl+Z dispatches UNDO to historyStore when no editor focused
10. Ctrl+Z is no-op when TipTap editor is focused (isEditableTarget = true)
11. Ctrl+Shift+Z dispatches REDO
12. Ctrl+Y dispatches REDO (Windows convention)
13. Cmd+Z dispatches UNDO on macOS
```

### Tech Debt Audit (6C)

| Check | Status |
|-------|--------|
| `useDragBatch.ts` under 45 lines | Verify |
| `useKeyboardShortcuts.ts` stays under 120 lines (~99 + 15 = ~114) | Verify |
| `KeyboardSection.tsx` stays under 40 lines (~37 + 2 = ~39) | Verify |
| No interference with TipTap undo (`isEditableTarget` guard) | Integration test |
| No closure variables in Zustand selectors | Code review |
| All `getState()` for imperative access in callbacks | Code review |
| Toast strings from resources | Code review |
| No stale closure in `useDragBatch` (`useRef` for snapshot) | Code review |
| Zero lint errors | `npm run lint` |
| All tests pass | `npm run test` |
| Build succeeds | `npm run build` |

**Debt incurred**: None. Keyboard handler follows existing pattern. Drag batch uses `useRef` (no stale closure). AI transform undo follows same `pushCmd` pattern.

---

## Sub-phase 6D: Undo/Redo Buttons in ZoomControls

### What We Build

Add undo/redo buttons to the bottom-left `ZoomControls` panel, above the existing zoom in/out and lock buttons. Greyed-out when stack is empty. Visual discoverability + mobile/tablet access.

### Layout

```
┌──────────┐
│ [Radar]  │
│ [↩ Undo] │  ← NEW (disabled when nothing to undo)
│ [↪ Redo] │  ← NEW (disabled when nothing to redo)
│ ──────── │  ← visual divider
│ [+ Zoom] │
│ [- Zoom] │
│ [🔒Lock] │
└──────────┘
  bottom-left
```

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/components/ZoomControls.tsx` | EDIT | Add undo/redo buttons (~20 lines) |
| `src/features/canvas/components/ZoomControls.module.css` | EDIT | Add `.divider` + `.disabled` styles (~12 lines) |
| `src/shared/localization/canvasStrings.ts` | EDIT | Add button label strings (~3 lines) |
| `src/features/canvas/components/__tests__/ZoomControls.test.tsx` | EDIT or NEW | ~80 |

### Implementation

**`ZoomControls.tsx`** — Add undo/redo buttons (total file ~90 lines, under 100-line component limit):

```tsx
import { useHistoryStore } from '../stores/historyStore';
import { strings } from '@/shared/localization/strings';

export const ZoomControls = memo(function ZoomControls() {
    const { zoomIn, zoomOut } = useReactFlow();
    const isCanvasLocked = useSettingsStore((s) => s.isCanvasLocked);

    // Derived selectors from isolated history store — no canvas cascade
    const canUndo = useHistoryStore((s) => s.undoStack.length > 0);
    const canRedo = useHistoryStore((s) => s.redoStack.length > 0);

    const handleUndo = useCallback(() => {
        useHistoryStore.getState().dispatch({ type: 'UNDO' });
    }, []);

    const handleRedo = useCallback(() => {
        useHistoryStore.getState().dispatch({ type: 'REDO' });
    }, []);

    // ... existing handlers ...
    const hc = strings.canvas.history;

    return (
        <div className={styles.container} data-testid="zoom-controls">
            <CanvasRadar />

            {/* Undo/Redo buttons */}
            <button
                className={`${styles.button} ${!canUndo ? styles.disabled : ''}`}
                onClick={handleUndo}
                disabled={!canUndo}
                aria-label={hc.undoButton}
                title={hc.undoTooltip}
                data-testid="undo-button"
            >
                {/* Undo SVG icon — counterclockwise arrow */}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7v6h6" />
                    <path d="M3 13a9 9 0 0 1 15.36-6.36" />
                </svg>
            </button>
            <button
                className={`${styles.button} ${!canRedo ? styles.disabled : ''}`}
                onClick={handleRedo}
                disabled={!canRedo}
                aria-label={hc.redoButton}
                title={hc.redoTooltip}
                data-testid="redo-button"
            >
                {/* Redo SVG icon — clockwise arrow */}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 7v6h-6" />
                    <path d="M21 13a9 9 0 0 0-15.36-6.36" />
                </svg>
            </button>

            <div className={styles.divider} />

            {/* Existing zoom/lock buttons unchanged */}
            ...
        </div>
    );
});
```

**`ZoomControls.module.css`** — Add styles:

```css
.divider {
    width: 100%;
    height: 1px;
    background: var(--color-border);
    margin: 2px 0;
}

.button:disabled,
.button.disabled {
    opacity: var(--opacity-disabled);  /* Fix #1: Use CSS variable (0.5) instead of hardcoded 0.3 */
    cursor: default;
    pointer-events: none;
}
```

**`canvasStrings.ts`** — Add button labels under `history`:

```typescript
undoButton: 'Undo',
undoTooltip: 'Undo last action (Ctrl+Z)',
redoButton: 'Redo',
redoTooltip: 'Redo last action (Ctrl+Shift+Z)',
```

### Zustand Safety

- `canUndo` and `canRedo` are selectors on `useHistoryStore` — **NOT** on `useCanvasStore`.
- ZoomControls re-renders only when history stack length changes, **never** when nodes/edges change.
- `handleUndo`/`handleRedo` use `getState().dispatch()` — stable callbacks, no subscriptions.
- No closure variables in selectors.

### TDD Tests

**`ZoomControls.test.tsx`** (~80 lines):

```
Unit Tests:
1. Undo button renders with correct aria-label from string resources
2. Redo button renders with correct aria-label from string resources
3. Undo button is disabled when undoStack is empty
4. Redo button is disabled when redoStack is empty
5. Undo button is enabled when undoStack has entries
6. Clicking undo button dispatches UNDO to historyStore
7. Clicking redo button dispatches REDO to historyStore
8. Divider element renders between undo/redo and zoom buttons
9. Existing zoom/lock buttons still render and work

Integration Tests:
10. Delete node → undo button becomes enabled → click undo → node restored → undo button disabled again
```

### Tech Debt Audit (6D)

| Check | Status |
|-------|--------|
| `ZoomControls.tsx` under 100 lines (~70 + 20 = ~90) | Verify |
| `ZoomControls.module.css` under 80 lines (~60 + 12 = ~72) | Verify |
| All labels from string resources (no hardcoded text) | Code review |
| All colors via CSS variables (no hardcoded hex) | Code review |
| `disabled` style uses `var(--opacity-disabled)` + `pointer-events: none` (accessible, theme-aware) | Code review |
| Selectors on `useHistoryStore` only (no canvas store coupling) | Code review |
| `useCallback` on handlers (stable refs for memo) | Code review |
| No `any` types | Code review |
| Zero lint errors | `npm run lint` |
| All tests pass | `npm run test` |
| Build succeeds | `npm run build` |

**Debt incurred**: None. Component stays under limit. All styles use CSS variables. Button state derived from isolated store selectors.

---

## Sub-phase 6E: Wire Delete Shortcut + Toast Feedback

### What We Build

Replace the raw `deleteNode` call in the keyboard shortcut handler with the undoable wrapper, and add toast feedback for undo/redo operations.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/app/hooks/useKeyboardShortcuts.ts` | EDIT | Replace raw delete with undoable delete (~5 lines changed) |
| `src/features/canvas/hooks/useUndoableActions.ts` | EDIT | Add toast on undo/redo dispatch (~10 lines) |
| `src/features/canvas/components/KeyboardShortcutsProvider.tsx` | EDIT | Pass undoable actions through (~3 lines) |

### Implementation

**`useKeyboardShortcuts.ts`** — Replace raw delete with undoable wrapper:

```typescript
// BEFORE (raw delete — no undo):
// if (e.key === 'Delete' || e.key === 'Backspace') {
//     const store = useCanvasStore.getState();
//     selectedNodeIds?.forEach((nodeId) => store.deleteNode(nodeId));
//     store.clearSelection();
// }

// AFTER (undoable delete):
if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    const ids = selectedNodeIds ? [...selectedNodeIds] : [];
    if (ids.length === 0) return;
    onDeleteNodes?.(ids);
    useCanvasStore.getState().clearSelection();
    return;
}
```

The `onDeleteNodes` callback comes from `KeyboardShortcutsProvider`, which calls `deleteNodeWithUndo` from `useUndoableActions`.

**Toast feedback** — Show brief toast only for **destructive** undos (delete, transform). Skip for cosmetic changes (color, move):

```typescript
// In the undo/redo dispatch wrapper:
const cmd = undoStack[undoStack.length - 1];
if (['deleteNode', 'batchDelete', 'transformContent'].includes(cmd.type)) {
    toast.info(strings.canvas.history.undoDelete);
}
```

### TDD Tests

```
1. Delete key with selected nodes calls onDeleteNodes (not raw deleteNode)
2. Undo after keyboard delete restores nodes
3. Toast shown on undo of deleteNode
4. Toast NOT shown on undo of moveNode (non-destructive)
5. Toast NOT shown on undo of changeColor (cosmetic)
```

### Tech Debt Audit (6E)

| Check | Status |
|-------|--------|
| `useKeyboardShortcuts.ts` stays under 120 lines | Verify |
| `KeyboardShortcutsProvider.tsx` stays under 35 lines (~27 + 3 = ~30) | Verify |
| Raw `deleteNode` no longer called from keyboard handler | Structural test |
| Toast strings from resources | Code review |
| Zero lint errors | `npm run lint` |
| All tests pass | `npm run test` |
| Build succeeds | `npm run build` |

**Debt incurred**: None. Existing raw delete replaced with undoable version. Toast is conditional and non-noisy.

---

## Sub-phase 6F: Workspace Cleanup + Structural Tests + Analytics

### What We Build

1. Clear history on workspace switch (history is session-scoped, not workspace-scoped).
2. Structural tests to enforce undo/redo wiring correctness.
3. Analytics tracking for undo/redo usage.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/workspace/hooks/useWorkspaceLoader.ts` | EDIT | Call `dispatch({ type: 'CLEAR' })` on workspace switch (~2 lines) |
| `src/features/canvas/__tests__/undoRedo.structural.test.ts` | NEW | ~55 |
| `src/shared/services/analyticsService.ts` | EDIT | Add `'canvas_undo'` and `'canvas_redo'` to `SettingKey` (~1 line) |

### Implementation

**`useWorkspaceLoader.ts`** — Clear history on workspace switch:

```typescript
import { useHistoryStore } from '@/features/canvas/stores/historyStore';

// Inside the workspace switch effect:
useHistoryStore.getState().dispatch({ type: 'CLEAR' });
```

**`analyticsService.ts`** — Extend SettingKey:

```typescript
type SettingKey =
    | 'theme' | 'canvasGrid' | 'autoSave' | 'autoSaveInterval'
    | 'compactMode' | 'canvasScrollMode' | 'connectorStyle'
    | 'isCanvasLocked' | 'canvasFreeFlow' | 'autoAnalyzeDocuments' | 'data_export'
    | 'branch_export' | 'canvas_undo' | 'canvas_redo';
```

### Structural Tests

**`undoRedo.structural.test.ts`** (~55 lines):

```
1. historyStore is a separate file from canvasStore (import path check)
2. historyReducer is a pure function export (no Zustand imports)
3. useHistoryStore does NOT appear in canvasStore.ts (isolation check)
4. useCanvasStore does NOT import from historyStore (no coupling)
5. useKeyboardShortcuts imports useHistoryStore for undo/redo dispatch
6. useKeyboardShortcuts uses isEditableTarget guard before undo/redo
7. useWorkspaceLoader calls dispatch({ type: 'CLEAR' }) (grep for 'CLEAR')
8. No undoStack/redoStack strings in workspaceService.ts (no Firestore persistence)
9. No undoStack/redoStack strings in any *Service.ts file (grep scan)
10. ZoomControls imports useHistoryStore (UI buttons wired)
11. canvasStrings.ts contains 'history' object with undo/redo labels
12. KeyboardSection includes undo/redo entries
```

### TDD Integration Tests

```
Full round-trip integration (in a single test file):
1. Add node → delete node → Ctrl+Z → node restored → Ctrl+Shift+Z → node deleted again
2. Drag node → Ctrl+Z → node at original position
3. Delete 3 nodes → Ctrl+Z → all 3 restored with edges
4. Switch workspace → history cleared → Ctrl+Z is no-op
5. 51 operations → oldest discarded → undoStack.length === 50
6. Delete node while TipTap focused → Ctrl+Z → TipTap undo (not canvas undo)
```

### Tech Debt Audit (6F — FINAL)

| Check | Status |
|-------|--------|
| `useWorkspaceLoader.ts` line count unchanged (+ 2 lines) | Verify |
| `analyticsService.ts` line count unchanged (+ 1 line) | Verify |
| History cleared on workspace switch | Structural test |
| No Firestore persistence of undo state | Structural test (grep) |
| History store isolated from canvas store | Structural test |
| All structural tests pass | `npm run test` |
| All unit tests pass | `npm run test` |
| All integration tests pass | `npm run test` |
| Zero lint errors | `npm run lint` |
| Build succeeds | `npm run build` |
| `find src -name "*.ts*" \| xargs wc -l \| awk '$1 > 300'` → empty | File audit |

**Debt incurred**: None. All wiring verified by structural tests. No Firestore leakage. Clean isolation enforced.

---

## Phase 6 Summary

### Execution Order

| Phase | What | Why This Order | Build Gate |
|-------|------|----------------|------------|
| 6A | History reducer + types + store | Foundation — pure logic, no UI | `npm run build && npm run test` |
| 6B | Undoable action wrappers + insertNodeAtIndex | Depends on 6A store | `npm run build && npm run test` |
| 6C | Keyboard binding + drag batch + AI transform undo | Depends on 6B wrappers | `npm run build && npm run test` |
| 6D | Undo/Redo buttons in ZoomControls | Depends on 6A store (reads canUndo/canRedo) | `npm run build && npm run test` |
| 6E | Wire delete shortcut + toast feedback | Depends on 6B wrappers + 6C keyboard | `npm run build && npm run test` |
| 6F | Workspace cleanup + structural tests + analytics | Depends on all above | `npm run build && npm run test && npm run lint` |

### Net Impact

- **Files created**: 8 (types, reducer, store, undoable hooks, drag batch, + tests)
- **Files edited**: 7 (canvasStore, canvasStoreActions, canvasStoreHelpers, keyboard hook, keyboard provider, ZoomControls, workspaceLoader, KeyboardSection, analyticsService, canvasStrings)
- **Net line count change**: ~+550 lines (new capability, no deletions)
- **Largest new file**: `historyReducer.ts` (~65 lines) — well under 300
- **User impact**: Ctrl+Z restores deleted nodes, moved nodes, removed edges, AI transforms — fearless experimentation
- **Performance**: Ring buffer capped at 50, structuredClone only on mutations (not on every render), history store completely isolated from canvas subscriptions

### Architectural Guarantees

| Guarantee | How Enforced |
|-----------|-------------|
| No Zustand cascade | Separate `useHistoryStore` — structural test verifies isolation |
| No ReactFlow "Maximum update depth" | History selectors on isolated store, not canvas store |
| No stale closures | `getState()` in all callbacks, `useRef` for drag snapshot |
| One-shot dispatch | Pure reducer → single `set(newState)` call |
| No closure variables in selectors | Structural test + code review |
| All strings from resources | `canvasStrings.ts` history object |
| All colors from CSS variables | `ZoomControls.module.css` uses `--color-*` |
| Security | `structuredClone` for snapshots, clamped index, no user input in closures |

### What's NOT Included

| Item | Reason |
|------|--------|
| Text content undo | TipTap handles this already |
| Cross-workspace undo | History is session-scoped per workspace |
| Persistent undo (survive reload) | Over-engineering — session undo covers 99% of use |
| Visual undo timeline | Phase 6 is functional only; visual timeline is future polish |
| Undo for bulk operations (clear canvas) | Too destructive for simple undo — confirm dialog is the guard |
