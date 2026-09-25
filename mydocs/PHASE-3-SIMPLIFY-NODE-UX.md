# Phase 3: Simplify the Node UX

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

## Problem Statement

The IdeaCard has accumulated 14 action IDs across 2 customizable decks (`ai`, `connect`, `copy`, `pin`, `delete`, `tags`, `image`, `attachment`, `duplicate`, `focus`, `collapse`, `color`, `share`, `pool`), plus a drag-to-reorder toolbar customization system in Settings. For new users, this is a wall of icons that obscures the canvas-first thinking experience. The dual-deck system with drag-and-drop reordering is over-engineered — it solves a configuration problem that most users never have. The proximity hover already helps, but the sheer volume of actions when the bar expands dilutes the core experience.

## Intended Solution

Reduce the primary NodeUtilsBar to **5 essential actions** in a single flat bar (no decks). Move all secondary actions into a right-click context menu that doubles as a "More..." overflow menu. Remove the entire dual-deck system: toolbar customization in Settings, layout persistence in the store, the controller state machine, and the pin-open mechanism (right-click is repurposed for the context menu). The node should feel lightweight — a card you think with, not a control panel you configure.

## Architecture Decisions

- **No new Zustand store** — context menu open/position state is local `useState` in IdeaCard
- **Remove code first, then simplify** — sub-phases ordered to delete dead code before building new code
- **Context menu** — rendered in a React portal, positioned at click coordinates, dismissed on outside-click/Escape
- **Submenus inside context menu** — Color and Share are nested sub-panels (reuse existing `ColorMenu`/`ShareMenu` with repositioned rendering); they are NOT flattened into single buttons
- **Transform/Regenerate stays on primary bar** — the AI slot conditionally renders `TransformMenu` (existing component) when the node has content, or a generate button when it doesn't. This is the existing pattern and it works well.
- **Prop reduction** — context menu receives `nodeId` and reads what it needs from stores directly, rather than receiving 10+ callback props threaded through parents
- **Right-click repurposed** — `useBarPinOpen` is deleted; right-click now opens the context menu. Long-press on mobile opens the same menu.
- **Backward compatibility** — old `utilsBarLayout` in localStorage is silently ignored (existing validation rejects unknown format, falls back to defaults that are no longer read)
- **No breaking changes to node data** — `IdeaNodeData` shape unchanged

---

## Sub-phase 3A: Remove the Deck System & Settings Infrastructure

### Why First

Removing dead code before building new code prevents writing against APIs that are about to be deleted. This phase has zero user-facing behavior change — the bar still renders, just always with the default layout (which is what 99% of users have anyway).

### Files

| File | Action | Notes |
|------|--------|-------|
| `src/app/components/SettingsPanel/sections/ToolbarSection.tsx` | DELETE | Drag-and-drop toolbar settings UI |
| `src/app/components/SettingsPanel/sections/ToolbarSection.module.css` | DELETE | |
| `src/app/components/SettingsPanel/sections/DeckColumn.tsx` | DELETE | Single deck column UI |
| `src/app/components/SettingsPanel/sections/DeckColumn.module.css` | DELETE | |
| `src/app/components/SettingsPanel/sections/useToolbarDrag.ts` | DELETE | HTML5 drag hook |
| `src/app/components/SettingsPanel/sections/__tests__/ToolbarSection.integration.test.tsx` | DELETE | |
| `src/shared/stores/utilsBarLayoutSlice.ts` | DELETE | 91-line store slice |
| `src/shared/stores/__tests__/utilsBarLayoutSlice.test.ts` | DELETE (if exists) | |
| `src/features/canvas/hooks/useUtilsBarLayout.ts` | DELETE | 19-line hook reading deck1/deck2 |
| `src/features/canvas/hooks/useBarPinOpen.ts` | DELETE | 61-line pin-open hook (right-click repurposed in 3C) |
| `src/app/components/SettingsPanel/SettingsPanel.tsx` | EDIT | Remove toolbar tab |
| `src/shared/stores/settingsStore.ts` | EDIT | Remove `utilsBarLayout` state, `setUtilsBarActionDeck`, `reorderUtilsBarAction`, `resetUtilsBarLayout`, and import of slice |
| `src/shared/localization/settingsStrings.ts` | EDIT | Remove toolbar section strings |
| `src/shared/stores/__tests__/settingsStore.test.ts` | EDIT | Remove deck-related tests |

### Implementation

**SettingsPanel**: Remove the "Toolbar" tab (goes from 6 tabs to 5: Appearance, Canvas, Account, Keyboard, About).

**settingsStore.ts**: Strip all layout-related state and actions. Old localStorage keys are simply ignored on next load (existing validation rejects, falls back to defaults — but now defaults are never read, so it's a no-op).

### TDD Tests

```
1. SettingsPanel renders 5 tabs (not 6)
2. No "Toolbar" tab in navigation
3. settingsStore has no utilsBarLayout in state
4. Old localStorage with utilsBarLayout loads without error (ignored)
```

### Tech Debt Checkpoint

- [ ] 10+ files deleted, net ~500 lines removed
- [ ] Settings panel stays under 100 lines
- [ ] settingsStore simplified
- [ ] No orphaned imports (`npx tsc --noEmit` verifies)
- [ ] Zero lint errors

---

## Sub-phase 3B: Simplify NodeUtilsBar to Flat 5-Action Bar

### What We Build

Replace the dual-deck NodeUtilsBar with a single flat bar: **AI/Transform, Connect, Copy, Delete, More**. Five buttons total. The AI slot reuses the existing `NodeUtilsBarAIOrTransform` component (which conditionally shows TransformMenu or a generate button). The "More" button opens the context menu built in 3C.

### Why 5 Actions (Not 6)

The original plan included `synthesize` and `export` as primary actions — but **these don't exist in the codebase**. `ALL_ACTION_IDS` has exactly 14 items; there's no `synthesize` or `export` anywhere. Adding phantom actions to the primary bar makes no sense. When these features land later, they can be added to the context menu (secondary actions) or promoted to the primary bar at that time. For now, the 5 actions that matter most for the core thinking flow are: AI, Connect, Copy, Delete, and More.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/types/utilsBarLayout.ts` | REWRITE | ~30 (down from 102) |
| `src/features/canvas/components/nodes/NodeUtilsBar.tsx` | REWRITE | ~55 (down from 73) |
| `src/features/canvas/components/nodes/NodeUtilsBar.module.css` | EDIT | Remove deck2 styles |
| `src/features/canvas/components/nodes/NodeUtilsBar.types.ts` | EDIT | Simplify props |
| `src/features/canvas/components/nodes/Deck1Actions.tsx` | DELETE | |
| `src/features/canvas/components/nodes/Deck2Actions.tsx` | DELETE | |
| `src/features/canvas/components/nodes/deckActionTypes.ts` | DELETE | |
| `src/features/canvas/components/nodes/NodeUtilsBarDeckButtons.tsx` | DELETE | |
| `src/features/canvas/hooks/useNodeUtilsBar.ts` | REWRITE | ~35 (down from 87) |
| `src/features/canvas/hooks/useNodeUtilsController.ts` | SIMPLIFY | Remove deck2 states; keep submenu toggle for Transform |
| `src/features/canvas/hooks/useIdeaCard.ts` | EDIT | Remove useBarPinOpen, remove useUtilsBarLayout |
| `src/features/canvas/components/nodes/IdeaCard.tsx` | EDIT | Remove pinOpenHandlers, add context menu state |
| `src/features/canvas/components/nodes/__tests__/NodeUtilsBar.test.tsx` | REWRITE | |

### Implementation

**New `utilsBarLayout.ts`** (~30 lines):

```typescript
// Primary bar -- fixed set, non-configurable
export const PRIMARY_ACTIONS = ['ai', 'connect', 'copy', 'delete'] as const;
export type PrimaryActionId = typeof PRIMARY_ACTIONS[number];

// Context menu -- all secondary actions
export const CONTEXT_MENU_ACTIONS = [
  'tags', 'color', 'pin', 'collapse', 'focus', 'duplicate',
  'image', 'attachment', 'share', 'pool'
] as const;
export type ContextMenuActionId = typeof CONTEXT_MENU_ACTIONS[number];

export type UtilsBarActionId = PrimaryActionId | ContextMenuActionId;

// Context menu groups for visual organization
export const CONTEXT_MENU_GROUPS = {
  organize: ['pin', 'duplicate', 'collapse', 'focus'] as const,
  appearance: ['tags', 'color'] as const,
  insert: ['image', 'attachment'] as const,
  sharing: ['share', 'pool'] as const,
} as const;
```

**New `NodeUtilsBar.tsx`** (~55 lines):

```typescript
export const NodeUtilsBar = React.memo(function NodeUtilsBar(props: NodeUtilsBarProps) {
  return (
    <div className={styles.bar} ref={props.containerRef}
      role="toolbar" aria-label={strings.canvas.nodeActions}
      onMouseEnter={props.onHoverEnter} onMouseLeave={props.onHoverLeave}>

      {/* AI slot -- reuses existing conditional component */}
      <NodeUtilsBarAIOrTransform
        onTransform={props.onTransform}
        isTransformOpen={props.isTransformOpen}
        onTransformToggle={props.onTransformToggle}
        onCloseSubmenu={props.onCloseSubmenu}
        onRegenerate={props.onRegenerate}
        disabled={props.disabled}
        hasContent={props.hasContent}
        isTransforming={props.isTransforming}
        tooltipPlacement="right"
        onAIClick={props.onAIClick}
      />

      {/* Fixed primary actions */}
      <TooltipButton icon={<LinkIcon />} label={strings.nodeUtils.connect}
        onClick={props.onConnectClick} tooltipPlacement="right" />
      <TooltipButton icon={<CopyIcon />} label={strings.nodeUtils.copy}
        onClick={props.onCopyClick} disabled={!props.hasContent}
        tooltipPlacement="right" />
      <TooltipButton icon={<TrashIcon />} label={strings.nodeUtils.delete}
        onClick={props.onDelete} tooltipPlacement="right"
        className={buttonStyles.deleteButton} />

      {/* More... opens context menu */}
      <TooltipButton icon={<MoreIcon />} label={strings.nodeUtils.more}
        onClick={props.onMoreClick}
        aria-haspopup="true" tooltipPlacement="right" />
    </div>
  );
});
```

Key differences from original plan:
- **No `synthesize`/`export` buttons** (they don't exist)
- **AI slot keeps `NodeUtilsBarAIOrTransform`** (preserves Transform/Regenerate submenu)
- **`onMoreClick` instead of inline `useState`** — state lives in IdeaCard, not NodeUtilsBar

**Simplified `useNodeUtilsBar.ts`** (~35 lines):
- Remove: `toggleDeckTwo`, `handleDeckTwoHoverEnter/Leave`, `isDeckTwoOpen`
- Keep: `containerRef`, `handleHoverEnter/Leave`, `handleProximityLost`, submenu toggles (transform only — Color/Share move to context menu)

**Simplified `useNodeUtilsController.ts`**:
- Remove: `TOGGLE_DECK_TWO` event, `deckTwoOpen` state
- Remove: `useHoverIntent` for deck2 hover-to-open
- Keep: `OPEN_SUBMENU`/`CLOSE_SUBMENU` for TransformMenu, `HOVER_LEAVE`, `ESCAPE`, `OUTSIDE_POINTER`

**`IdeaCard.tsx` edits**:
- Remove: `pinOpenHandlers`, `isPinnedOpen` prop on bar
- Add: `contextMenuPos` state (`{x, y} | null`), `onContextMenu` handler, `onMoreClick` handler
- Pass `onMoreClick` and context menu trigger to NodeUtilsBar

### TDD Tests

```
1. Renders exactly 5 buttons (AI + connect + copy + delete + more)
2. AI button calls onAIClick when no content
3. AI button shows TransformMenu when hasContent + onTransform
4. Connect button calls onConnectClick
5. Copy button disabled when hasContent=false
6. Delete button calls onDelete
7. More button calls onMoreClick
8. All labels from string resources
9. React.memo applied (structural test)
10. role="toolbar" and aria-label present
```

### Tech Debt Checkpoint

- [ ] NodeUtilsBar under 60 lines
- [ ] 4 files deleted (Deck1Actions, Deck2Actions, deckActionTypes, DeckButtons)
- [ ] useNodeUtilsBar under 40 lines (down from 87)
- [ ] CSS simplified — no orphaned deck2 classes
- [ ] All strings from resources
- [ ] Zero lint errors

---

## Sub-phase 3C: Node Context Menu

### What We Build

A right-click context menu (also opened via "More..." button) that contains all secondary actions, grouped logically. Color and Share render as expandable sub-panels that reuse existing `ColorMenu`/`ShareMenu` components in embedded mode (not as standalone portal dropdowns).

### Design Decisions

**Why not a flat list for Color/Share?** Color needs a color picker (4 options with dots). Share needs a dynamic workspace list. Flattening these into single `<MenuItem>` buttons would lose functionality. Instead, clicking "Color" in the context menu expands an inline sub-panel showing the color options. Same for Share.

**Why `nodeId` prop instead of callback sprawl?** The context menu needs callbacks for 10 secondary actions. Threading all of these through props (IdeaCard -> NodeUtilsBar -> ContextMenu) creates prop drilling across 3 layers. Instead, the context menu takes `nodeId` and uses `useIdeaCardHandlers`-style direct store access for actions. This is the same pattern the existing handlers use.

**Position calculation**: For "More..." button click, position the menu adjacent to the button (right edge). For right-click, position at cursor coordinates. Clamp to viewport edges.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/components/nodes/NodeContextMenu.tsx` | NEW | ~85 |
| `src/features/canvas/components/nodes/NodeContextMenu.module.css` | NEW | ~60 |
| `src/features/canvas/components/nodes/useNodeContextMenu.ts` | NEW | ~45 |
| `src/features/canvas/components/nodes/__tests__/NodeContextMenu.test.tsx` | NEW | ~100 |
| `src/features/canvas/components/nodes/IdeaCard.tsx` | EDIT | Wire context menu (+10 lines) |
| `src/shared/localization/strings.ts` | EDIT | Add context menu group labels |

### Implementation

**`useNodeContextMenu.ts`** (~45 lines) — Hook encapsulating context menu logic:

```typescript
interface ContextMenuState {
  position: { x: number; y: number } | null;  // null = closed
}

export function useNodeContextMenu() {
  const [state, setState] = useState<ContextMenuState>({ position: null });
  const isOpen = state.position !== null;

  const openAtCursor = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ position: { x: e.clientX, y: e.clientY } });
  }, []);

  const openAtElement = useCallback((element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setState({ position: { x: rect.right + 4, y: rect.top } });
  }, []);

  const close = useCallback(() => setState({ position: null }), []);

  return { isOpen, position: state.position, openAtCursor, openAtElement, close };
}
```

**`NodeContextMenu.tsx`** (~85 lines):

```typescript
interface NodeContextMenuProps {
  readonly nodeId: string;
  readonly position: { x: number; y: number };
  readonly onClose: () => void;
}

export const NodeContextMenu = React.memo(function NodeContextMenu({
  nodeId, position, onClose
}: NodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [expandedPanel, setExpandedPanel] = useState<'color' | 'share' | null>(null);

  // Read node state directly from store (no prop drilling)
  const nodeData = useNodeData(nodeId);
  const isPinned = nodeData?.isPinned ?? false;
  const isCollapsed = nodeData?.isCollapsed ?? false;

  // Close on Escape
  useEscapeLayer(ESCAPE_PRIORITY.CONTEXT_MENU, true, onClose);

  // Close on outside click — but NOT on canvas pan/zoom interactions.
  // The pointerdown listener must check that the click target is not inside the
  // ReactFlow canvas pane (which would indicate a pan gesture, not an intentional dismiss).
  // Without this guard, starting a canvas pan closes the menu immediately.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return; // click inside menu
      // Allow canvas pan without closing: check if target is the ReactFlow pane
      const target = e.target as HTMLElement;
      if (target.closest('.react-flow__pane')) {
        // Canvas background click = intentional dismiss (user clicked empty space)
        // Canvas node drag = NOT a dismiss (started dragging a node near the menu)
        // Heuristic: if target is exactly the pane (not a child node), close.
        if (target.classList.contains('react-flow__pane')) {
          onClose();
        }
        return; // Don't close for node drags or other canvas interactions
      }
      onClose();
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [onClose]);

  // Viewport clamping
  const clampedPosition = useViewportClamp(position, menuRef);

  return createPortal(
    <div className={styles.menu} ref={menuRef} role="menu"
      style={{ top: clampedPosition.y, left: clampedPosition.x }}>

      {/* Organize group */}
      <MenuGroup label={strings.contextMenu.organize}>
        <MenuItem icon="pin" label={isPinned ? strings.nodeUtils.unpin : strings.nodeUtils.pin}
          onClick={() => { handlers.onPinToggle(); onClose(); }} />
        <MenuItem icon="duplicate" label={strings.nodeUtils.duplicate}
          onClick={() => { handlers.onDuplicate(); onClose(); }} />
        <MenuItem icon="collapse" label={isCollapsed ? strings.nodeUtils.expand : strings.nodeUtils.collapse}
          onClick={() => { handlers.onCollapseToggle(); onClose(); }} />
        <MenuItem icon="focus" label={strings.nodeUtils.focus}
          onClick={() => { handlers.onFocusClick(); onClose(); }} />
      </MenuGroup>

      <div className={styles.separator} role="separator" />

      {/* Appearance group */}
      <MenuGroup label={strings.contextMenu.appearance}>
        <MenuItem icon="tags" label={strings.nodeUtils.tags}
          onClick={() => { handlers.onTagClick(); onClose(); }} />
        <MenuItemExpandable icon="color" label={strings.nodeUtils.color}
          expanded={expandedPanel === 'color'}
          onToggle={() => setExpandedPanel(expandedPanel === 'color' ? null : 'color')}>
          <InlineColorPicker nodeId={nodeId} onSelect={onClose} />
        </MenuItemExpandable>
      </MenuGroup>

      <div className={styles.separator} role="separator" />

      {/* Insert group */}
      <MenuGroup label={strings.contextMenu.insert}>
        <MenuItem icon="image" label={strings.nodeUtils.image}
          onClick={() => { handlers.onImageClick(); onClose(); }} />
        <MenuItem icon="attachment" label={strings.nodeUtils.attachment}
          onClick={() => { handlers.onAttachmentClick(); onClose(); }} />
      </MenuGroup>

      <div className={styles.separator} role="separator" />

      {/* Sharing group */}
      <MenuGroup label={strings.contextMenu.sharing}>
        <MenuItemExpandable icon="share" label={strings.nodeUtils.share}
          expanded={expandedPanel === 'share'}
          onToggle={() => setExpandedPanel(expandedPanel === 'share' ? null : 'share')}>
          <InlineSharePanel nodeId={nodeId} onSelect={onClose} />
        </MenuItemExpandable>
        <MenuItem icon="pool" label={strings.nodeUtils.pool}
          onClick={() => { handlers.onPoolToggle(); onClose(); }} />
      </MenuGroup>
    </div>,
    document.body
  );
});
```

**Key differences from original plan:**
- **No backdrop div** — uses `pointerdown` listener instead. A backdrop would intercept all canvas interactions (pan/zoom).
- **`nodeId` prop, not 10+ callback props** — reads store directly, reducing prop drilling.
- **Expandable sub-panels** for Color/Share — preserves existing picker/list UX inside the menu.
- **`useEscapeLayer`** — reuses existing escape priority system instead of ad-hoc `keydown` listener. **Note**: `ESCAPE_PRIORITY.CONTEXT_MENU` does not exist yet in `escapePriorities.ts` (current values: 10-80). Add `CONTEXT_MENU: 45` — higher than `BAR_OVERFLOW` (40) so context menu dismisses before the bar, but lower than `FOCUS_MODE` (50).
- **Viewport clamping** — prevents menu from rendering off-screen (right-click near edge).
- **Canvas pan guard** — `pointerdown` outside-click handler distinguishes between "click empty canvas to dismiss" and "start panning". Only closes on direct `.react-flow__pane` clicks, not on node drags or pan gestures starting from nodes.

**InlineColorPicker / InlineSharePanel** (~30 lines each): Thin wrappers that extract the option list rendering from existing `ColorMenu`/`ShareMenu` without the trigger button or portal. These can be extracted as simple render functions or tiny components.

**IdeaCard.tsx changes**:

```typescript
// Replace pinOpenHandlers with context menu
const contextMenu = useNodeContextMenu();

// onContextMenu opens context menu (replaces pin-open right-click)
const handleContextMenu = contextMenu.openAtCursor;

// "More" button opens context menu adjacent to the bar
const handleMoreClick = useCallback(() => {
  if (barContainerRef.current) contextMenu.openAtElement(barContainerRef.current);
}, [contextMenu.openAtElement]);
```

### TDD Tests

```
1. Renders all 10 secondary action items across 4 groups
2. Groups separated by visual dividers
3. Click action calls handler + closes menu
4. Escape closes menu (via useEscapeLayer)
5. Click outside menu closes it
6. Toggle items show correct state (Pin/Unpin, Collapse/Expand)
7. Color expandable panel shows 4 color options
8. Share expandable panel shows workspace list
9. All labels from string resources
10. role="menu" and role="menuitem" present
11. Renders in portal (document.body)
12. Right-click on IdeaCard opens context menu at click coordinates
13. "More" button opens context menu adjacent to bar
14. Menu clamps to viewport edges
15. Canvas pan (pointerdown on node, not pane) does NOT close menu
16. Click on empty canvas background (react-flow__pane) DOES close menu
```

### Tech Debt Checkpoint

- [ ] NodeContextMenu under 100 lines
- [ ] useNodeContextMenu under 50 lines
- [ ] CSS uses only variables
- [ ] All strings from resources
- [ ] Keyboard accessible (Escape via useEscapeLayer)
- [ ] Portal rendering (no z-index fights)
- [ ] IdeaCard stays under 100 lines
- [ ] Zero lint errors

---

## Sub-phase 3D: Clean Up Controller & Hook Infrastructure

### What We Build

Simplify the state machine and hooks now that deck2 is gone. This is a focused cleanup pass.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/hooks/useNodeUtilsController.ts` | SIMPLIFY | ~40 (down from 72) |
| `src/features/canvas/hooks/nodeUtilsControllerReducer.ts` | SIMPLIFY | Remove TOGGLE_DECK_TWO, HOVER_LEAVE deck2 logic |
| `src/features/canvas/hooks/useHoverIntent.ts` | DELETE (if only used for deck2) | |
| `src/features/canvas/hooks/useNodeUtilsBarOutsideHandlers.ts` | SIMPLIFY | |
| `src/features/canvas/hooks/__tests__/*.test.ts` | EDIT | Remove deck2 test cases |

### Implementation

**useNodeUtilsController**: Remove `TOGGLE_DECK_TWO` event handling, `deckTwoOpen` state, `useHoverIntent` dependency. The controller now only manages: hover enter/leave (for proximity bar visibility) and transform submenu open/close.

**nodeUtilsControllerReducer**: Simplify `NodeUtilsMode` from `'idle' | 'deckTwoOpen' | 'submenuOpen'` to `'idle' | 'submenuOpen'`. Remove events: `TOGGLE_DECK_TWO`. The `HOVER_LEAVE` event now always returns to `idle` (no deck2 to keep open).

**useHoverIntent**: If this hook is only used for deck2 hover-to-open behavior, delete it. If it's used elsewhere, keep it.

### TDD Tests

```
1. Controller starts in idle mode
2. OPEN_SUBMENU transitions to submenuOpen
3. CLOSE_SUBMENU returns to idle
4. ESCAPE returns to idle
5. No TOGGLE_DECK_TWO event exists
6. HOVER_LEAVE from idle stays idle
```

### Tech Debt Checkpoint

- [ ] useNodeUtilsController under 50 lines
- [ ] Reducer has no deck2 references
- [ ] No orphaned exports
- [ ] Zero lint errors

---

## Sub-phase 3E: Structural & Integration Tests

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/components/nodes/__tests__/nodeSimplification.structural.test.ts` | NEW | ~50 |

### Structural Tests

```
1. NodeUtilsBar renders <= 5 buttons (AI + connect + copy + delete + more)
2. No Deck1Actions, Deck2Actions, deckActionTypes imports anywhere in codebase
3. No ToolbarSection imports anywhere in codebase
4. No utilsBarLayout in settingsStore state
5. No useBarPinOpen imports anywhere in codebase
6. NodeContextMenu uses portal (createPortal)
7. All labels from string resources (grep scan)
8. No Zustand anti-patterns in modified files
9. No useUtilsBarLayout imports anywhere
10. Right-click on IdeaCard does NOT call preventDefault without opening context menu
```

### Build Gate Checklist (Full Phase 3)

```bash
npx tsc --noEmit          # zero errors
npm run lint               # zero errors
npm run test               # ALL pass
find src -name "*.ts*" | xargs wc -l | awk '$1 > 300'  # audit
```

---

## Phase 3 Summary

### Execution Order

| Phase | What | Why This Order |
|-------|------|----------------|
| 3A | Remove deck system + settings | Delete dead code first; unblocks simplification |
| 3B | Simplify bar to 5 actions | Depends on 3A (no more deck reading) |
| 3C | Build context menu | Depends on 3B (More button wired) |
| 3D | Clean up controller/hooks | Depends on 3B/3C (know what's actually used) |
| 3E | Structural tests | Depends on all above (validates final state) |

### What Was Removed From the Original Plan

| Item | Reason |
|------|--------|
| `synthesize` + `export` primary actions | These features don't exist in the codebase. Add when they land. |
| `hasChildren` prop | Only needed for synthesize/export which don't exist. |
| Sub-phase 3E "Clearer Heading/Prompt UX" | Unrelated to simplification. AI badge adds UI rather than removing it. Should be its own mini-phase. |
| Backdrop overlay for context menu | Intercepts canvas pan/zoom. Use `pointerdown` listener instead. |
| 10+ callback props threaded to context menu | Context menu reads store directly via `nodeId`. |

### What Was Added

| Item | Reason |
|------|--------|
| `useNodeContextMenu` hook | Encapsulates open/close/position logic cleanly |
| Expandable sub-panels (Color, Share) | Preserves existing picker/list UX inside context menu |
| `useNodeUtilsController` simplification | Original plan ignored this 72-line state machine |
| `useBarPinOpen` deletion | Right-click conflict — can't both pin-open AND open context menu |
| `useUtilsBarLayout` deletion | No more layout to read from store |
| `utilsBarLayoutSlice` deletion | No more layout persistence |
| Viewport clamping for context menu | Right-click near screen edge needs clamping |
| Sub-phase 3D (controller cleanup) | Original plan left ~250 lines of dead hook/reducer code |

### Tech Debt Audit

| Potential Debt | How We Prevent It |
|---------------|-------------------|
| Orphaned imports after deletion | `npx tsc --noEmit` catches missing imports; structural test scans for deleted file names |
| Orphaned CSS classes | Deleted CSS files entirely; remaining files audited for unused selectors |
| Old localStorage format | Existing validation rejects unknown format; layout is no longer read at all |
| Feature regression | All action callbacks preserved — they moved to context menu, not removed |
| Missing a11y | Context menu has Escape (useEscapeLayer), role="menu", role="menuitem" |
| Right-click conflict | useBarPinOpen fully removed; right-click exclusively opens context menu |
| Submenu complexity in context menu | Color/Share use expandable panels, not flattened buttons |
| Hardcoded strings | Structural test scans all modified/new component files |
| Zustand anti-patterns | No new store subscriptions; context menu reads via `useNodeData(nodeId)` selector |
| Canvas interaction blocked | No backdrop overlay; `pointerdown` listener checks target — canvas pane clicks dismiss, but node drags and pan gestures do NOT close the menu |
| Missing CONTEXT_MENU escape priority | `ESCAPE_PRIORITY.CONTEXT_MENU = 45` added to `escapePriorities.ts` — between BAR_OVERFLOW (40) and FOCUS_MODE (50) |

### Net Impact

**Files deleted**: ~16 (source + CSS + tests)
**Files created**: 5 (NodeContextMenu + CSS + hook + tests + structural test)
**Net line count change**: Approximately **-700 lines**
**Actions visible on hover**: 14 -> 5 (64% reduction)
**Settings tabs**: 6 -> 5
**Zustand store actions removed**: 3 (`setUtilsBarActionDeck`, `reorderUtilsBarAction`, `resetUtilsBarLayout`)
