# Phase 6: Fearless Canvas — Undo/Redo & Safe Deletions

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

> **Design Principle**: The canvas should feel like a playground — users freely add, move, and remove content with zero fear. Every destructive action is instantly reversible. No accidental data loss, ever.

## UX Philosophy: Delete-First, Toast-to-Undo

**Confirmation dialogs are anti-playground.** They interrupt flow, create decision fatigue, and punish exploration. Instead, we follow the pattern used by Gmail, Figma, Notion, and Slack:

```
Delete instantly → Show toast with [Undo] button → Auto-dismiss after 6s
```

| Action | UX Pattern | Why |
|--------|-----------|-----|
| Delete 1–4 nodes | Actionable undo toast (6s) | Zero friction, easy recovery |
| Delete 5+ nodes | Confirmation dialog, then undo toast | Bulk warrants a pause |
| Clear Canvas | Confirmation dialog + undoable | Catastrophic action |
| Delete edge | Actionable undo toast (6s) | Edges are easy to miss |
| Delete Workspace | Confirmation dialog (not undoable) | Permanent, server-side |
| Undo/Redo | No confirmation, no toast | Mechanical, expected |

**The undo toast IS the safety net.** It makes recovery visible and one-click accessible — no keyboard shortcut knowledge required.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  User Action (delete key, button, context menu) │
└────────────────────┬────────────────────────────┘
                     │
         ┌───────────▼───────────────┐
         │  Threshold check (≥5?)    │
         │  YES → confirm dialog     │
         │  NO  → proceed            │
         └───────────┬───────────────┘
                     │
         ┌───────────▼───────────────┐
         │  Execute deletion         │
         │  Push to history stack    │
         │  Show actionable toast    │
         │  with [Undo] button       │
         └───────────┬───────────────┘
                     │
         ┌───────────▼───────────────┐
         │  Toast [Undo] clicked?    │
         │  YES → dispatch UNDO      │
         │  NO  → auto-dismiss 6s    │
         └───────────────────────────┘
```

---

## Sub-phase 1 — Actionable Toast Infrastructure

### 1A. Extend Toast Store with Action Callback

**File**: `src/shared/stores/toastStore.ts`

Add an optional `action` field to Toast:

```typescript
interface Toast {
    id: string;
    message: string;
    type: ToastType;
    action?: { label: string; onClick: () => void };  // NEW
}

// New convenience function
addToastWithAction: (message, type, action, durationMs?) => void;
```

- `action.label` renders as a clickable button inside the toast (e.g., "Undo")
- `action.onClick` fires the undo dispatch when clicked
- Clicking the action button auto-dismisses the toast
- Duration extended to 6000ms for actionable toasts (more time to decide)
- String resource: `strings.common.undo` for the button label

### 1B. Update Toast Component

**File**: `src/shared/components/Toast.tsx`

Add the action button between message and close:

```tsx
{t.action && (
    <button className={styles.action} onClick={() => { t.action!.onClick(); handleRemove(t.id); }}>
        {t.action.label}
    </button>
)}
```

### 1C. Toast Action Button Styles

**File**: `src/shared/components/Toast.module.css`

```css
.action {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    text-decoration: underline;
    color: inherit;
    opacity: 0.9;
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-sm);
    white-space: nowrap;
    cursor: pointer;
}
.action:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.15);
}
```

### 1D. Strings

**File**: `src/shared/localization/strings.ts` (common section)

```typescript
undo: 'Undo',
```

**File**: `src/shared/localization/canvasStrings.ts` (history section)

```typescript
nodeDeleted: 'Node deleted',
nodesDeleted: (count: number) => `${count} nodes deleted`,
edgeDeleted: 'Connection removed',
canvasCleared: 'Canvas cleared',
deleteNodesConfirmTitle: 'Delete nodes',
deleteNodesConfirm: (count: number) => `Delete ${count} nodes? This can be undone.`,
deleteNodesConfirmButton: 'Delete',
```

### 1E. Tests
- Toast with action renders button, fires onClick, auto-dismisses.
- Toast without action renders as before (no regression).
- Actionable toast uses 6s timeout.
- String resources exist and are typed.

### 1F. Tech Debt Audit
- `toastStore.ts` stays under 75 lines.
- `Toast.tsx` stays under 50 lines.
- No `any`, no hardcoded strings/colors.

---

## Sub-phase 2 — Actionable Undo Toasts for Node Deletion

### 2A. Wire Undo Toast into `deleteNodeWithUndo`

**File**: `src/features/canvas/hooks/useUndoableActions.ts`

After executing deletion and pushing to history:

```typescript
const deleteNodeWithUndo = useCallback((nodeIds: string[], edgeIds: string[] = []) => {
    // ... existing freeze + withUndo logic ...

    // Show actionable toast with [Undo] button
    const msg = nodeIds.length === 1
        ? hc.nodeDeleted
        : hc.nodesDeleted(nodeIds.length);
    toastWithAction(msg, 'info', {
        label: strings.common.undo,
        onClick: () => useHistoryStore.getState().dispatch({ type: 'UNDO' }),
    });
}, []);
```

**Key detail**: The toast's [Undo] button calls `dispatch({ type: 'UNDO' })` — the same path as Ctrl+Z. This means:
- The historyStore handles the actual undo logic (restore nodes/edges)
- Analytics fire automatically (`trackCanvasUndo`)
- No duplicate undo logic

### 2B. Bulk Deletion Threshold (≥5 nodes)

**File**: `src/features/canvas/hooks/useUndoableActions.ts`

```typescript
const deleteNodeWithUndo = useCallback(async (
    nodeIds: string[],
    edgeIds: string[] = [],
    confirm?: (opts: ConfirmOptions) => Promise<boolean>
) => {
    // Confirmation only for bulk deletes (5+ nodes)
    if (nodeIds.length >= 5 && confirm) {
        const confirmed = await confirm({
            title: hc.deleteNodesConfirmTitle,
            message: hc.deleteNodesConfirm(nodeIds.length),
            confirmText: hc.deleteNodesConfirmButton,
            isDestructive: true,
        });
        if (!confirmed) return;
    }

    // ... existing freeze + withUndo + toast logic ...
}, []);
```

**Threshold = 5**: Deleting 1–4 nodes is normal brainstorming. 5+ suggests a deliberate bulk action worth confirming. The confirmation message says "This can be undone." to reassure even when confirming.

### 2C. Remove Undo Toast from historyStore dispatch

**File**: `src/features/canvas/stores/historyStore.ts`

Since `deleteNodeWithUndo` now shows its own actionable toast, remove the duplicate plain toast from historyStore's UNDO handler for `deleteNode`/`batchDelete`. The historyStore should still handle toast for `transformContent` (which doesn't go through `deleteNodeWithUndo`).

```typescript
// Update TOAST_ON_UNDO to only include non-deletion types
const TOAST_ON_UNDO: ReadonlySet<string> = new Set(['transformContent']);
```

### 2D. Edge Deletion Undo Toast

**File**: `src/features/canvas/components/edges/DeletableEdge.tsx`

After deleting edge and pushing to history, show actionable toast:

```typescript
toastWithAction(hc.edgeDeleted, 'info', {
    label: strings.common.undo,
    onClick: () => useHistoryStore.getState().dispatch({ type: 'UNDO' }),
});
```

### 2E. Tests
- Delete 1 node → toast shows "Node deleted" with [Undo] button, no confirmation dialog.
- Delete 3 nodes → toast shows "3 nodes deleted" with [Undo] button, no confirmation dialog.
- Delete 5 nodes → confirmation dialog appears, confirmed → toast with [Undo].
- Delete 5 nodes → confirmation dialog appears, cancelled → no deletion, no toast, history untouched.
- Click [Undo] in toast → node(s) restored, toast dismissed.
- Delete edge → toast shows "Connection removed" with [Undo] button.
- Ctrl+Z still works independently of toast.
- No double-undo if user clicks [Undo] button AND presses Ctrl+Z (guard: if undoStack is empty or top command doesn't match, no-op).

### 2F. Tech Debt Audit
- `useUndoableActions.ts` stays under 100 lines (async adds ~8 lines).
- File size check on all modified files.
- No Zustand anti-patterns (all getState() for actions).

---

## Sub-phase 3 — Undoable Clear Canvas

### 3A. Make Clear Canvas Undoable

**File**: `src/features/canvas/hooks/useUndoableActions.ts`

New function: `clearCanvasWithUndo`

```typescript
const clearCanvasWithUndo = useCallback(async (
    confirm: (opts: ConfirmOptions) => Promise<boolean>
) => {
    const state = useCanvasStore.getState();
    if (state.nodes.length === 0) return; // Nothing to clear

    const confirmed = await confirm({
        title: hc.clearConfirmTitle,
        message: hc.clearConfirm,
        confirmText: hc.clearConfirmButton,
        isDestructive: true,
    });
    if (!confirmed) return;

    // Snapshot entire canvas (structuredClone)
    const frozenNodes = structuredClone(state.nodes);
    const frozenEdges = structuredClone(state.edges);

    withUndo('clearCanvas', () => {
        useCanvasStore.getState().clearCanvas();
    }, () => {
        // UNDO: restore all nodes and edges
        frozenNodes.forEach(node => useCanvasStore.getState().addNode(node));
        frozenEdges.forEach(edge => {
            const currentNodeIds = new Set(useCanvasStore.getState().nodes.map(n => n.id));
            if (currentNodeIds.has(edge.sourceNodeId) && currentNodeIds.has(edge.targetNodeId)) {
                useCanvasStore.getState().addEdge(edge);
            }
        });
    });

    // Actionable toast
    toastWithAction(hc.canvasCleared, 'info', {
        label: strings.common.undo,
        onClick: () => useHistoryStore.getState().dispatch({ type: 'UNDO' }),
    });
}, []);
```

### 3B. Add `clearCanvas` to CanvasCommandType

**File**: `src/features/canvas/types/history.ts`

```typescript
export type CanvasCommandType =
    | 'addNode' | 'deleteNode' | 'batchDelete' | 'moveNode'
    | 'addEdge' | 'deleteEdge' | 'changeColor' | 'transformContent'
    | 'clearCanvas';  // NEW
```

### 3C. Wire ClearCanvasButton to `clearCanvasWithUndo`

**File**: `src/features/workspace/components/ClearCanvasButton.tsx`

Replace direct `clearCanvas()` call with `clearCanvasWithUndo()` from the hook. The confirmation dialog is now inside the hook, so ClearCanvasButton becomes a thin trigger.

### 3D. History NOT Cleared on clearCanvas

Currently `clearCanvas()` in canvasStore also clears the history. Remove that — the history must persist so undo restores the cleared canvas. History only clears on workspace **switch** (which is correct).

### 3E. Tests
- Clear canvas with 10 nodes → confirmation → nodes gone → click [Undo] → all 10 nodes + edges restored.
- Clear canvas cancelled → no changes.
- Clear empty canvas → no-op (no dialog, no toast).
- Undo after clear canvas restores node positions, colors, content, edges.
- Ctrl+Z after clear canvas works same as [Undo] button.

### 3F. Tech Debt Audit
- Memory: structuredClone of full canvas (~500 nodes max) is ~2MB, acceptable for 1 entry in 50-depth stack.
- `useUndoableActions.ts` may need splitting if it exceeds 100 lines — extract `clearCanvasWithUndo` to separate hook if needed.

---

## Sub-phase 4 — Visible Undo/Redo Toolbar Buttons

### 4A. Undo/Redo Button Component

**File**: `src/features/canvas/components/UndoRedoButtons.tsx` (~40 lines)

```typescript
// Compact undo/redo buttons for canvas toolbar
// Uses historyStore selectors for disabled state
// Renders: [↩ Undo] [↪ Redo] with tooltips showing keyboard shortcuts
```

- **Undo button**: disabled when `undoStack.length === 0`
- **Redo button**: disabled when `redoStack.length === 0`
- Tooltips show `strings.canvas.history.undoTooltip` / `redoTooltip`
- Compact icon-only design with hover tooltips (matches existing toolbar aesthetic)
- `React.memo` for performance

### 4B. Place in Canvas Layout

Position the undo/redo buttons in the bottom-left toolbar area (near zoom controls) or top toolbar. They should be visible but unobtrusive.

### 4C. Selector for Stack Emptiness

**File**: `src/features/canvas/stores/historyStore.ts`

Add derived selectors:

```typescript
export const selectCanUndo = (s: HistoryStore) => s.undoStack.length > 0;
export const selectCanRedo = (s: HistoryStore) => s.redoStack.length > 0;
```

Components use: `const canUndo = useHistoryStore(selectCanUndo);` — only re-renders when emptiness toggles, not on every push.

### 4D. Tests
- Undo button disabled when undoStack empty.
- Redo button disabled when redoStack empty.
- Click undo → dispatches UNDO action.
- Click redo → dispatches REDO action.
- Buttons update after node delete/undo/redo cycle.

### 4E. Tech Debt Audit
- Component under 50 lines.
- Uses selectors (no bare store subscription).

---

## Sub-phase 5 — Keyboard Shortcuts & Integration Polish

### 5A. Keyboard Flow Verification

Verify all deletion paths correctly go through undoable wrappers:

| Path | Handler | Undoable | Toast |
|------|---------|----------|-------|
| Delete/Backspace key | `useKeyboardShortcuts` → `deleteNodeWithUndo` | Yes | Actionable |
| NodeUtilsBar delete | IdeaCard → `deleteNodeWithUndo` | Yes | Actionable |
| Edge midpoint delete | DeletableEdge → inline push + toast | Yes | Actionable |
| Clear Canvas button | `clearCanvasWithUndo` | Yes | Actionable |
| Delete Workspace | `DeleteWorkspaceButton` → confirm → server delete | N/A | N/A |

### 5B. Guard Against Double-Undo

If user clicks [Undo] in toast and then presses Ctrl+Z, the second undo should undo the *previous* action (not the same one). This is handled naturally by the history stack — the first undo pops the command, so the second undo gets the next one. No extra guard needed.

### 5C. Workspace Switch Warning

**File**: `src/features/workspace/hooks/useWorkspaceLoader.ts`

Before clearing history on workspace switch, check if the undo stack contains destructive operations. If so, the switch proceeds (history is session-scoped and users expect workspace isolation), but we should ensure this is clean.

No warning needed — workspace switch is an intentional navigation. History clearing is expected behavior. Over-warning creates the same fatigue we're avoiding.

### 5D. Escape Key Interaction

Ensure Escape doesn't interfere with undo toasts. Toast dismissal is click-only or timeout-based, not Escape-based. The escape layer system handles its own priorities and doesn't touch toasts.

### 5E. Integration Tests

End-to-end scenarios:
1. Add 3 nodes → delete 2 → toast appears → click [Undo] → 2 nodes restored → redo button enabled.
2. Delete node via keyboard → Ctrl+Z → node back → Ctrl+Shift+Z → node gone again.
3. Delete 6 nodes → confirmation → confirm → toast → [Undo] → all 6 back.
4. Clear canvas → [Undo] → everything restored.
5. Delete node → delete another node → undo × 2 → both back (stack ordering).
6. Delete node → add node → undo → added node removed (correct stack order).

---

## Sub-phase 6 — Structural & Regression Tests

### 6A. Structural Assertions

- `useUndoableActions` imports toast helpers.
- `deleteNodeWithUndo` does NOT import `useConfirm` directly (threshold check receives confirm as parameter).
- `ClearCanvasButton` uses `clearCanvasWithUndo` (not raw `clearCanvas`).
- `historyStore` does NOT toast for `deleteNode`/`batchDelete` (moved to point of action).
- All 5 deletion paths are covered by undo.
- `toastStore` interface includes `action` field.

### 6B. Regression Guard

- Zustand selector structural test still passes (no new anti-patterns).
- No `any` types in new code.
- All files under 300 lines, hooks under 100, components under 100.
- No hardcoded strings (all from `strings.*`).

### 6C. Analytics Coverage

Ensure analytics track:
- `trackCanvasUndo(type)` — already wired via historyStore dispatch.
- `trackCanvasRedo(type)` — already wired.
- New: consider tracking "undo via toast button" vs "undo via keyboard" to measure toast UX effectiveness. Optional — only if analytics service supports it without bloat.

---

## Edge-Case Summary

| Scenario | Behavior |
|----------|----------|
| Delete 1 node | Instant delete → toast with [Undo] (6s) |
| Delete 4 nodes (multi-select) | Instant delete → toast "4 nodes deleted" with [Undo] |
| Delete 5+ nodes | Confirmation dialog → delete → toast with [Undo] |
| Delete 5+ cancelled | No deletion, no toast, no history entry |
| Clear Canvas | Confirmation → delete all → toast with [Undo] |
| Clear empty canvas | No-op |
| Click [Undo] in toast | Nodes/edges restored, toast dismissed |
| Ctrl+Z after [Undo] click | Undoes the *previous* action (correct stack behavior) |
| Toast expires (6s) | Normal — user can still Ctrl+Z |
| Delete during undo toast | New deletion pushes new history entry; old toast remains |
| Undo/Redo via keyboard | No confirmation, no toast (mechanical action) |
| Workspace switch | History clears (expected — workspaces are isolated) |
| History stack full (50) | Oldest entry dropped, newest preserved |
| Delete node being edited | Clears editing state, then undoable delete |
| Edge deletion | Toast with [Undo], orphan guard on restore |
| Undo clear canvas | All nodes + edges restored at original positions |

---

## What This Plan Does NOT Do (Deliberate Omissions)

1. **No trash/recycle bin** — The undo stack IS the recovery mechanism. A separate trash adds UI complexity, storage burden, and conceptual overhead. The 50-depth undo stack with 6s actionable toasts provides sufficient safety for a brainstorming canvas.

2. **No persistent undo across sessions** — History is session-scoped and clears on workspace switch. Persisting closures (structuredClone'd nodes) to Firestore would add significant complexity for marginal benefit. Users expect session-scoped undo (same as Figma, VS Code, etc.).

3. **No undo for workspace deletion** — Workspace deletion is a server-side Firestore operation. Making it undoable would require soft-delete flags, TTL cleanup, and storage quotas. The confirmation dialog is the right pattern here.

4. **No confirmation for 1–4 node deletes** — This is a deliberate UX choice. Confirmation dialogs for small deletions create friction that discourages exploration. The actionable undo toast provides the same safety with zero friction.

---

## Implementation Order & Dependencies

```
Sub-phase 1 (Toast infra)     ← No dependencies, pure shared layer
    ↓
Sub-phase 2 (Node deletion)   ← Depends on 1 (actionable toast)
    ↓
Sub-phase 3 (Clear canvas)    ← Depends on 1 (actionable toast)
    ↓
Sub-phase 4 (Toolbar buttons) ← Independent, can parallel with 2/3
    ↓
Sub-phase 5 (Integration)     ← Depends on 2, 3, 4
    ↓
Sub-phase 6 (Structural)      ← Depends on all above
```

Sub-phases 2+3 and 4 can be developed in parallel after Sub-phase 1 is complete.

---

## Success Criteria

The canvas feels like a playground when:
- Deleting a node takes 0 clicks of confirmation (just the delete action itself)
- Recovery is always one click away (toast [Undo] button) or one keystroke (Ctrl+Z)
- Users can see undo/redo are available (toolbar buttons, toast buttons)
- Even catastrophic actions (clear canvas) are reversible
- The only truly permanent action is deleting a workspace (server-side, confirmed)

**Zero accidental data loss. Zero friction. Maximum confidence.**
