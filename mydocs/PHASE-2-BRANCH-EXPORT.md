# Phase 2: Branch Export — Canvas → Document

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

## Problem Statement

Canvas thinking produces spatial knowledge structures, but the only export is a raw JSON dump (`useDataExport.ts`) that no human can read. Users who spend an hour building a research canvas with 15 connected nodes cannot turn that into a shareable document, email, or presentation outline. They must manually copy each node's content and restructure it linearly — which defeats the entire purpose of thinking on a canvas. BASB's "Express" move is broken.

## Intended Solution

Let users select a root node and export its entire downstream branch as a structured markdown document. The canvas topology determines document structure: root → `# Title`, direct children → `## Sections`, grandchildren → `### Subsections`. Two export paths: **Quick Copy** (one-click clipboard copy from SelectionToolbar) and **Export Dialog** (preview, AI polish, file download). Synthesis nodes from Phase 1 are recognized and formatted distinctly in the output.

## Architecture Decision

- **New feature module**: `src/features/export/` (MVVM, feature-first)
- **Shared download utility**: Extracted from existing `useDataExport.ts` pattern into `src/shared/utils/fileDownload.ts` — reused by both JSON export and branch export
- **Pure functions for traversal + conversion** — no side effects, easy to test
- **AI polish is optional** — the core export works without any API call; uses `generateContent()` (simpler signature, no context chain needed)
- **Export dialog is a modal** — uses existing `var(--z-modal)` z-index layer, `createPortal` to `document.body`
- **No new Zustand store** — dialog open/close via local component state
- **No Deck2Actions integration** — Phase 3 deletes the dual-deck system entirely. Export triggers from SelectionToolbar (multi-node) only. Single-node branch export will be wired in Phase 3's context menu.
- **Analytics**: Branch export tracks via `trackSettingsChanged()`. **Important**: The current `SettingKey` type is a union of specific string literals (`'theme' | 'canvasGrid' | ... | 'data_export'`). `'branch_export'` must be added to the `SettingKey` union in `analyticsService.ts` before use, or reuse the existing `'data_export'` key with a distinguishing value (e.g., `trackSettingsChanged('data_export', 'branch_quick_copy')`).
- **Security**: Filenames sanitized (timestamp only), no script injection in markdown output, blob URLs revoked with delay

---

## Sub-phase 2A: Shared Download Utility

### What We Build

Extract the Blob → ObjectURL → anchor.click → revoke pattern from `useDataExport.ts` into a shared utility. Both JSON workspace export and branch markdown export use the same download logic.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/shared/utils/fileDownload.ts` | NEW | ~20 |
| `src/shared/utils/__tests__/fileDownload.test.ts` | NEW | ~40 |
| `src/features/workspace/hooks/useDataExport.ts` | EDIT | refactor to use shared utility (-10 lines) |

### Implementation

**`fileDownload.ts`**:

```typescript
const REVOKE_DELAY_MS = 200;

/**
 * Downloads content as a file via temporary blob URL.
 * Revokes the URL after a delay to allow the browser to initiate the download.
 */
export function downloadAsFile(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
```

**`useDataExport.ts`** refactor — replace inline blob logic with:
```typescript
import { downloadAsFile } from '@/shared/utils/fileDownload';

// ... inside exportData:
const json = JSON.stringify(payload, null, 2);
downloadAsFile(json, `actionstation-export-${Date.now()}.json`, 'application/json');
```

**Key decisions**:
- `REVOKE_DELAY_MS = 200` follows existing codebase convention from `useDataExport.ts` — immediate revocation races with browser download initiation
- Pure function, no side effects beyond DOM manipulation
- `mimeType` parameter allows reuse for `text/markdown`, `text/plain`, `application/json`

### TDD Tests

```
1. downloadAsFile creates Blob with correct content and mimeType
2. downloadAsFile sets anchor.download to filename
3. downloadAsFile calls anchor.click()
4. downloadAsFile revokes URL after delay (not immediately)
5. useDataExport still works after refactor (regression)
```

### Tech Debt Checkpoint

- [ ] File under 300 lines (target: ~20)
- [ ] No `any` types
- [ ] `useDataExport` simplified (net line reduction)
- [ ] Zero lint errors

---

## Sub-phase 2B: Branch Traversal Service

### What We Build

A pure function that takes a root node ID and returns an ordered tree structure following outgoing edges (`sourceNodeId` → `targetNodeId` = parent → child).

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/export/services/branchTraversal.ts` | NEW | ~65 |
| `src/features/export/services/__tests__/branchTraversal.test.ts` | NEW | ~150 |

### Implementation

**`branchTraversal.ts`**:

```typescript
export interface BranchNode {
  readonly id: string;
  readonly heading: string;
  readonly content: string;              // output text
  readonly attachments: readonly AttachmentExport[];
  readonly tags: readonly string[];
  readonly children: readonly BranchNode[];
  readonly depth: number;
  readonly isSynthesis: boolean;         // true if colorKey === 'synthesis'
  readonly synthesisSourceCount: number; // length of synthesisSourceIds, or 0
}

export interface AttachmentExport {
  readonly filename: string;
  readonly summary: string;  // extraction?.summary ?? ''
}

export function collectBranch(
  rootId: string,
  allNodes: readonly CanvasNode[],
  allEdges: readonly CanvasEdge[]
): BranchNode | null

export function collectMultiRootBranch(
  selectedIds: ReadonlySet<string>,
  allNodes: readonly CanvasNode[],
  allEdges: readonly CanvasEdge[]
): readonly BranchNode[]
```

**Algorithm (`collectBranch`)**:
1. Build adjacency map: `sourceId → targetIds[]` (outgoing edges only — `sourceNodeId` is parent, `targetNodeId` is child)
2. Build node lookup map: `id → CanvasNode`
3. Find root node — return `null` if not found
4. Recursive DFS from root, tracking `visited: Set<string>` to handle cycles
5. For each node, extract:
   - `heading`: `node.data.heading || node.data.prompt || ''`
   - `content`: `node.data.output || ''`
   - `attachments`: map each `AttachmentMeta` to `{ filename, summary: attachment.extraction?.summary ?? '' }`
   - `tags`: `node.data.tags || []`
   - `isSynthesis`: `node.data.colorKey === 'synthesis'`
   - `synthesisSourceCount`: `(node.data.synthesisSourceIds as string[])?.length ?? 0`
6. Children = all nodes reachable via outgoing edges from this node (filtered by visited check). **Diamond DAG handling**: When a node is skipped because it was already visited (e.g., D reached via B first, then via C), insert a `BranchNode` placeholder with `heading` set to `node.heading` and `content` set to a cross-reference string (e.g., `exportStrings.sections.seeAbove`). This prevents content loss in exported documents where the reader follows the C branch and finds no mention of D.
7. Assign depth (root = 0, increments per level)

**`collectMultiRootBranch`**: For multi-select export:
1. Filter edges to only those within selection
2. Find roots (no incoming edges within selection)
3. Call `collectBranch` logic for each root
4. Return array of root `BranchNode` trees

**Security**: Node content is plain text from Zustand store. No HTML parsing, no URL construction, no user input used as file paths. Attachment summary path is `attachment.extraction?.summary` (Zod-validated by `ExtractionResultSchema`).

### TDD Tests

```
1. Single node (no children) → returns leaf BranchNode with depth 0
2. Linear chain A→B→C → tree with A.children=[B], B.children=[C]
3. Branching A→B, A→C → A.children=[B,C]
4. Cycle A→B→A → B does not re-include A (visited guard)
5. Diamond A→B→D, A→C→D → D appears under B only (first visit wins); C's branch includes a cross-reference note: `(see §B above)` — prevents content loss in document exports where the reader expects all paths covered
6. Root not found → returns null
7. Node with no heading → heading defaults to ''
8. Node with no output → content defaults to ''
9. Node with attachments → AttachmentExport populated with extraction?.summary
10. Node with tags → tags array populated
11. Multi-root: {A→B} + {C→D} selected → returns [A-tree, C-tree]
12. Depth assigned correctly in 4-level tree
13. Nodes outside selection excluded in multi-root mode
14. Synthesis node → isSynthesis=true, synthesisSourceCount matches stored IDs
15. Regular node → isSynthesis=false, synthesisSourceCount=0
16. Node with attachment but no extraction → summary defaults to ''
```

### Tech Debt Checkpoint

- [ ] File under 300 lines
- [ ] Pure functions — no side effects, no store calls
- [ ] Attachment summary read from `extraction?.summary` (correct path)
- [ ] No `any` types
- [ ] Zero lint errors

---

## Sub-phase 2C: Tree-to-Markdown Converter

### What We Build

A pure function that converts a `BranchNode` tree into structured markdown. Synthesis nodes are formatted distinctly so the export is self-documenting.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/export/services/markdownExporter.ts` | NEW | ~75 |
| `src/features/export/services/__tests__/markdownExporter.test.ts` | NEW | ~130 |
| `src/shared/localization/exportStrings.ts` | NEW | ~30 |
| `src/shared/localization/strings.ts` | EDIT | +2 lines |

### Implementation

**`exportStrings.ts`**:

```typescript
export const exportStrings = {
  labels: {
    exportBranch: 'Export branch',
    exportSelection: 'Export selection',
    copyBranch: 'Copy as markdown',
    copyToClipboard: 'Copy to clipboard',
    download: 'Download',
    polish: 'Polish with AI',
    polishing: 'Polishing...',
    preview: 'Preview',
    copied: 'Copied to clipboard',
    downloadComplete: 'Download complete',
    noContent: 'No content to export',
    exportError: 'Export failed',
  },
  sections: {
    attachments: 'Attachments',
    tags: 'Tags',
    synthesizedFrom: 'Synthesized from',
    ideas: 'ideas',
    generatedBy: 'Generated from canvas by ActionStation',
    seeAbove: '(see above)',
  },
  prompts: {
    polishInstruction: 'Improve the flow and transitions between sections of this document. Fix any grammatical issues. Do NOT add, remove, or change the meaning of any content. Preserve all headings, facts, and structure. Return the improved document in markdown format.',
  },
} as const;
```

**`markdownExporter.ts`**:

```typescript
export function branchToMarkdown(roots: readonly BranchNode[]): string
```

**Markdown structure** — regular nodes:
```markdown
# Root Node Heading

Root node content goes here...

**Attachments:**
- invoice.pdf — AI extracted summary of invoice...

**Tags:** research, finance, Q4

## Child Node Heading

Child content...

### Grandchild Heading

Grandchild content...
```

**Markdown structure** — synthesis nodes get a distinct format:
```markdown
## [Synthesis] Business Strategy Summary
*Synthesized from 5 ideas*

The synthesized content goes here...
```

**Footer**:
```markdown
---

*Generated from canvas by ActionStation*
```

**Rules**:
- Heading depth = `#` repeated `depth + 1` times (max `######` at depth 5, clamp after)
- Synthesis nodes: heading prefixed with `[Synthesis]`, italic source count line below heading
- Empty heading → skip heading line (content-only section)
- Empty content → skip content (heading-only section)
- Attachments section only if attachments exist with non-empty summaries
- Tags as comma-separated list only if tags exist
- `---` separator between top-level roots (multi-root export)
- Footer attribution line from `exportStrings.sections.generatedBy`

**No plain text format**: Markdown is universally supported (pastes cleanly into Google Docs, Notion, email clients, etc.). A separate plain-text converter adds code surface and test burden for a format nobody will prefer. If needed later, it's a trivial addition.

**Security**: Output is pure markdown text. No HTML tags emitted. No `<script>`, no `javascript:` URLs. Attachment filenames displayed as plain text (not links — we don't expose Firebase Storage URLs in exports).

### TDD Tests

```
1. Single root with heading + content → "# Heading\n\nContent"
2. Two-level tree → "# Root\n\n...\n\n## Child\n\n..."
3. Three-level tree → correctly nested ### headings
4. Depth > 5 → clamped to ######
5. Empty heading → no heading line, just content
6. Empty content → heading only, no blank content
7. Attachments → "**Attachments:**\n- filename — summary"
8. Attachment with empty summary → omitted from attachments section
9. Tags → "**Tags:** tag1, tag2"
10. Multi-root → roots separated by ---
11. Footer present with attribution string from exportStrings
12. Synthesis node → heading prefixed with "[Synthesis]"
13. Synthesis node → shows "Synthesized from N ideas" subtitle
14. Regular node → no synthesis prefix
15. All section labels from exportStrings (structural grep)
16. No HTML tags in output (security: grep for < and >)
17. Empty tree → returns '' (no crash)
```

### Tech Debt Checkpoint

- [ ] File under 300 lines
- [ ] All labels from `exportStrings.ts`
- [ ] No HTML in output
- [ ] `strings.ts` aggregator updated
- [ ] Zero lint errors

---

## Sub-phase 2D: AI Polish Service

### What We Build

An optional AI pass that improves flow and transitions in the exported markdown while preserving all content. Uses `generateContent()` (not `generateContentWithContext()`) — there's no context chain or pool needed, just a prompt with inline content.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/export/services/polishService.ts` | NEW | ~35 |
| `src/features/export/services/__tests__/polishService.test.ts` | NEW | ~60 |

### Implementation

**`polishService.ts`**:

```typescript
import { generateContent } from '@/features/ai/services/geminiService';
import { exportStrings } from '@/shared/localization/exportStrings';

export async function polishExport(rawMarkdown: string): Promise<string> {
  if (!rawMarkdown.trim()) return '';

  try {
    const prompt = `${exportStrings.prompts.polishInstruction}\n\n---\n\n${rawMarkdown}`;
    const polished = await generateContent(prompt);
    return polished;
  } catch {
    // Graceful degradation — return original on any error
    return rawMarkdown;
  }
}
```

**Key decisions**:
- Uses `generateContent(prompt)` — the simpler Gemini function. No context chain (`string[]`), no pool context, no KB context. The raw markdown is embedded directly in the prompt as clearly delimited content.
- `generateContentWithContext` is for upstream node chain context — wrong tool for this job.
- Empty markdown guard prevents wasted API call.
- Graceful degradation: on any error, user gets their original export (not nothing).

**Security**: The raw markdown is user-generated content placed after a `---` delimiter in the prompt (not as a system instruction). The Gemini response replaces the export content — React's `MarkdownRenderer` escapes any HTML if re-displayed.

### TDD Tests

```
1. polishExport calls generateContent with prompt containing polishInstruction
2. polishExport returns Gemini response as polished markdown
3. Gemini error → returns original rawMarkdown (no throw)
4. Empty markdown → returns '' (no API call made)
5. Whitespace-only markdown → returns '' (no API call made)
6. Prompt uses exportStrings.prompts.polishInstruction (not hardcoded)
7. Raw markdown appears after --- delimiter in prompt sent to Gemini
```

### Tech Debt Checkpoint

- [ ] File under 300 lines (target: ~35)
- [ ] Uses `generateContent()` not `generateContentWithContext()`
- [ ] Graceful degradation on error
- [ ] No `any` types
- [ ] Zero lint errors

---

## Sub-phase 2E: Export Dialog UI

### What We Build

A modal dialog with markdown preview, AI polish toggle, and copy/download actions. Rendered in a portal to `document.body` following the existing `ColorMenu`/`TransformMenu` pattern.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/export/components/ExportDialog.tsx` | NEW | ~70 |
| `src/features/export/components/ExportPreview.tsx` | NEW | ~25 |
| `src/features/export/components/ExportDialog.module.css` | NEW | ~80 |
| `src/features/export/components/__tests__/ExportDialog.test.tsx` | NEW | ~120 |
| `src/features/export/hooks/useExportDialog.ts` | NEW | ~70 |
| `src/features/export/hooks/__tests__/useExportDialog.test.ts` | NEW | ~90 |

### Implementation

**`useExportDialog.ts`** — orchestrates the export flow:

```typescript
interface UseExportDialogReturn {
  readonly markdown: string;
  readonly isPolishing: boolean;
  readonly togglePolish: () => Promise<void>;
  readonly copyToClipboard: () => Promise<void>;
  readonly download: () => void;
}

export function useExportDialog(
  roots: readonly BranchNode[]
): UseExportDialogReturn
```

**Internal state**: `useReducer` (not Zustand) — manages `isPolishing`, `polishedMarkdown`, `isPolished`.

**Flow**:
- On initialization: `branchToMarkdown(roots)` → base markdown (memoized)
- `togglePolish()`: if not yet polished, calls `polishExport()` and stores result; if already polished, toggles back to raw. On error: shows `toast.error(exportStrings.labels.exportError)`, keeps original.
- `copyToClipboard()`: `navigator.clipboard.writeText(markdown)` → `toast.success(exportStrings.labels.copied)`. Follows existing pattern from `useIdeaCardActions.ts`.
- `download()`: calls `downloadAsFile(markdown, filename, 'text/markdown')` from shared utility. Filename: `actionstation-export-${Date.now()}.md`. Calls `trackSettingsChanged('branch_export', 'download')` for analytics.

**`ExportPreview.tsx`** — extracted sub-component to keep ExportDialog under 100 lines:

```typescript
interface ExportPreviewProps {
  readonly content: string;
}

export const ExportPreview = React.memo(function ExportPreview({ content }: ExportPreviewProps) {
  return (
    <div className={styles.preview}>
      <MarkdownRenderer content={content} className={styles.previewContent} />
    </div>
  );
});
```

Uses existing `MarkdownRenderer` from `src/shared/components/MarkdownRenderer.tsx` (accepts `content: string` + optional `className`).

**`ExportDialog.tsx`**:

```typescript
interface ExportDialogProps {
  readonly roots: readonly BranchNode[];
  readonly onClose: () => void;
}

export const ExportDialog = React.memo(function ExportDialog({
  roots, onClose
}: ExportDialogProps) {
  const { markdown, isPolishing, togglePolish, copyToClipboard, download } = useExportDialog(roots);

  // Escape key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-modal="true"
           aria-label={exportStrings.labels.exportSelection}
           onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2>{exportStrings.labels.exportSelection}</h2>
          <button onClick={onClose} aria-label={strings.common.close}>✕</button>
        </header>
        <ExportPreview content={markdown} />
        <footer className={styles.actions}>
          <button onClick={togglePolish} disabled={isPolishing}>
            {isPolishing ? exportStrings.labels.polishing : exportStrings.labels.polish}
          </button>
          <button onClick={copyToClipboard}>{exportStrings.labels.copyToClipboard}</button>
          <button onClick={download}>{exportStrings.labels.download}</button>
        </footer>
      </div>
    </div>,
    document.body
  );
});
```

**Layout**:
```
┌──────────────────────────────────────┐
│  Export selection           [✕ Close] │
├──────────────────────────────────────┤
│                                      │
│  ┌──── Preview ────────────────────┐ │
│  │ # Heading                       │ │
│  │ Content preview...              │ │
│  │ ## [Synthesis] Summary          │ │
│  │ *Synthesized from 3 ideas*      │ │
│  │ More content...                 │ │
│  └─────────────────────────────────┘ │
│                                      │
│  [✨ Polish with AI]  [📋 Copy]  [⬇] │
└──────────────────────────────────────┘
```

**CSS** — all variables:
- Modal: `var(--color-surface-elevated)`, `var(--shadow-lg)`, `var(--radius-xl)`
- Preview area: `var(--color-surface)`, `var(--radius-md)`, scrollable, max-height 60vh
- Buttons: existing button patterns from the codebase
- z-index: `var(--z-modal)` (300)
- Backdrop: uses `var(--color-backdrop)` or `rgba(0,0,0,0.5)` fallback
- Portal renders to `document.body` (following existing `ColorMenu`/`TransformMenu`/`ShareMenu` pattern)

### TDD Tests

**ExportDialog.test.tsx**:
```
1. Renders preview with markdown content via MarkdownRenderer
2. "Copy to clipboard" calls navigator.clipboard.writeText with markdown
3. "Download" calls downloadAsFile with correct filename and mimeType
4. Polish toggle calls polishExport and updates preview
5. Polish toggle while polishing → disabled
6. Close button calls onClose
7. Escape key calls onClose
8. Backdrop click calls onClose
9. Content click does NOT close (stopPropagation)
10. Loading state shown during polishing
11. All labels from exportStrings
12. aria-modal="true" and role="dialog" present
13. Renders in portal (document.body)
```

**useExportDialog.test.ts**:
```
1. Initial markdown generated from branchToMarkdown(roots)
2. togglePolish calls polishExport with current markdown
3. togglePolish again → reverts to raw markdown (toggle behavior)
4. copyToClipboard calls navigator.clipboard.writeText
5. copyToClipboard shows toast.success on success
6. copyToClipboard shows toast.error on clipboard failure
7. download calls downloadAsFile with 'text/markdown' mimeType
8. download calls trackSettingsChanged for analytics
9. Polish error → original markdown preserved, toast.error shown
10. Empty roots → markdown is '' (no crash)
```

### Tech Debt Checkpoint

- [ ] ExportDialog under 100 lines (target: ~70 with ExportPreview extracted)
- [ ] ExportPreview under 100 lines (target: ~25)
- [ ] useExportDialog under 75 lines (target: ~70)
- [ ] All strings from `exportStrings`
- [ ] CSS uses only variables
- [ ] `useReducer` for local state
- [ ] Toast via `toast.success()` / `toast.error()` pattern (not raw `useToastStore.getState().addToast()`)
- [ ] Uses `downloadAsFile` shared utility (not inline blob logic)
- [ ] Uses `MarkdownRenderer` for preview (not `dangerouslySetInnerHTML`)
- [ ] Keyboard accessible (Escape closes, focus trap)
- [ ] Portal renders to `document.body`
- [ ] Zero lint errors

---

## Sub-phase 2F: Trigger Points (SelectionToolbar Only)

### What We Build

Wire the export dialog AND a quick-copy action into the SelectionToolbar from Phase 1. **No Deck2Actions integration** — Phase 3 deletes the dual-deck system entirely and replaces it with a flat bar + context menu. Single-node branch export will be wired in Phase 3's context menu.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/synthesis/components/SelectionToolbar.tsx` | EDIT | +15 lines (add Copy + Export buttons) |
| `src/features/synthesis/components/SelectionToolbar.module.css` | EDIT | +10 lines (new button styles) |
| `src/features/synthesis/components/__tests__/SelectionToolbar.test.tsx` | EDIT | +25 lines |

### Implementation

**SelectionToolbar** — add two export actions next to "Synthesize":

```typescript
// Quick Copy — one-click, no dialog. Covers 80% of use cases.
<button onClick={handleQuickCopy} className={styles.quickCopyBtn}
  aria-label={exportStrings.labels.copyBranch}>
  <CopyIcon size={16} />
  {exportStrings.labels.copyBranch}
</button>

// Full Export — opens dialog with preview, polish, download
<button onClick={handleOpenExport} className={styles.exportBtn}
  aria-label={exportStrings.labels.exportSelection}>
  <ExportIcon size={16} />
  {exportStrings.labels.exportSelection}
</button>
```

**Quick Copy flow** (inline, no dialog):
```typescript
const handleQuickCopy = useCallback(() => {
  const nodes = useCanvasStore.getState().nodes;
  const edges = useCanvasStore.getState().edges;
  const selected = useCanvasStore.getState().selectedNodeIds;
  const roots = collectMultiRootBranch(selected, nodes, edges);

  if (roots.length === 0) {
    toast.error(exportStrings.labels.noContent);
    return;
  }

  const markdown = branchToMarkdown(roots);
  navigator.clipboard.writeText(markdown)
    .then(() => toast.success(exportStrings.labels.copied))
    .catch(() => toast.error(exportStrings.labels.exportError));

  // NOTE: 'branch_export' must be added to SettingKey union in analyticsService.ts,
  // OR reuse 'data_export' with distinguishing value: trackSettingsChanged('data_export', 'branch_quick_copy')
  trackSettingsChanged('branch_export', 'quick_copy');
}, []);
```

**Full Export flow**:
```typescript
const handleOpenExport = useCallback(() => {
  const nodes = useCanvasStore.getState().nodes;
  const edges = useCanvasStore.getState().edges;
  const selected = useCanvasStore.getState().selectedNodeIds;
  const roots = collectMultiRootBranch(selected, nodes, edges);

  if (roots.length === 0) {
    toast.error(exportStrings.labels.noContent);
    return;
  }

  setExportRoots(roots);  // local state → triggers ExportDialog render
}, []);
```

**ExportDialog rendering** — in SelectionToolbar, rendered in portal when `exportRoots` is set:
```typescript
{exportRoots && (
  <ExportDialog roots={exportRoots} onClose={() => setExportRoots(null)} />
)}
```

**Why no Deck2Actions integration**:
Phase 3 (Sub-phase 3B) deletes `Deck1Actions.tsx`, `Deck2Actions.tsx`, `deckActionTypes.ts`, and `NodeUtilsBarDeckButtons.tsx`. Adding `'export'` to Deck2Actions now means modifying `utilsBarLayout.ts` types, `Deck2Actions.tsx` render switch, `NodeUtilsBar.types.ts` props, and `useIdeaCardActions.ts` handlers — all of which get rewritten or deleted in Phase 3. The single-node "Export branch" action will be added to Phase 3's `NodeContextMenu` (the right-click/overflow menu that replaces the dual-deck system).

### TDD Tests

```
1. SelectionToolbar shows "Copy as markdown" button when 2+ nodes selected
2. SelectionToolbar shows "Export selection" button when 2+ nodes selected
3. Quick copy: calls collectMultiRootBranch → branchToMarkdown → clipboard.writeText
4. Quick copy: shows toast.success on success
5. Quick copy: shows toast.error when no content to export
6. Quick copy: tracks analytics event
7. Export button: opens ExportDialog with correct roots
8. ExportDialog onClose clears exportRoots state
9. Empty selection after multi-root collect → shows error toast, no dialog
```

### Tech Debt Checkpoint

- [ ] SelectionToolbar stays under 100 lines after edit
- [ ] All strings from string resources
- [ ] Quick copy uses `toast.success()` / `toast.error()` pattern
- [ ] Analytics tracked via `trackSettingsChanged`
- [ ] No Deck2Actions modifications (avoided — Phase 3 deletes it)
- [ ] Zero lint errors

---

## Sub-phase 2G: Structural & Integration Tests

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/export/__tests__/export.structural.test.ts` | NEW | ~60 |
| `src/features/export/__tests__/export.integration.test.ts` | NEW | ~120 |

### Structural Tests

```typescript
describe('Export structural safety', () => {
  test('markdownExporter uses only exportStrings — no hardcoded labels', ...);
  test('polishService uses generateContent, not generateContentWithContext', ...);
  test('No any types in export feature', ...);
  test('All export files under 300 lines', ...);
  test('No HTML tags in markdownExporter output function', ...);
  test('useExportDialog uses downloadAsFile shared utility (not inline blob)', ...);
  test('Blob URL revocation present in downloadAsFile (setTimeout pattern)', ...);
  test('No Zustand anti-patterns in export feature', ...);
  test('ExportDialog renders via createPortal', ...);
  test('Toast calls use toast.success/toast.error helpers (not raw addToast)', ...);
});
```

### Integration Test

```typescript
describe('Export end-to-end', () => {
  test('3-node tree → branchToMarkdown → expected markdown structure', async () => {
    // Setup: A→B→C with headings and content
    // Act: collectBranch(A.id, nodes, edges) → branchToMarkdown([root])
    // Assert: markdown has # A, ## B, ### C with correct content
  });

  test('branch with synthesis node → synthesis formatting applied', async () => {
    // Setup: A→B→S (S is synthesis node with synthesisSourceIds)
    // Act: collectBranch(A.id, ...) → branchToMarkdown
    // Assert: S heading prefixed with [Synthesis], source count shown
  });

  test('quick copy flow → clipboard contains markdown', async () => {
    // Setup: 3 selected nodes
    // Act: trigger handleQuickCopy
    // Assert: clipboard.writeText called with branchToMarkdown output
    //         toast.success shown
    //         analytics tracked
  });

  test('full dialog flow → preview → polish → download', async () => {
    // Setup: 2 selected nodes, open ExportDialog
    // Act: verify preview, toggle polish, click download
    // Assert:
    //   - Preview shows MarkdownRenderer with initial content
    //   - Polish calls generateContent (not generateContentWithContext)
    //   - Download calls downloadAsFile with 'text/markdown'
  });

  test('polish error → graceful degradation', async () => {
    // Setup: Gemini returns error
    // Act: toggle polish
    // Assert: original markdown preserved, toast.error shown
  });

  test('multi-root flow: 2 disconnected trees → both in export with separator', async () => {
    // Setup: {A→B} + {C→D} selected
    // Act: collectMultiRootBranch → branchToMarkdown
    // Assert: both trees present, separated by ---
  });

  test('empty selection → toast error, no dialog or clipboard action', async () => ...);
});
```

### Build Gate Checklist (Full Phase 2)

```bash
npx tsc --noEmit          # zero errors
npm run lint               # zero errors
npm run test               # ALL pass
# File audit:
find src/features/export -name "*.ts*" | xargs wc -l | awk '$1 > 300'  # empty
# String audit:
grep -r "['\"]\w.*\w['\"]" src/features/export/components/ --include="*.tsx" | grep -v import | grep -v strings  # empty
# Zustand audit:
grep -rn "useCanvasStore()" src/features/export/ --include="*.ts*"  # empty (no bare calls)
# API audit:
grep -n "generateContentWithContext" src/features/export/  # empty (should use generateContent)
# Toast audit:
grep -n "addToast" src/features/export/  # empty (should use toast.success/error helpers)
```

---

## Phase 2 Tech Debt Audit

| Potential Debt | How We Prevented It |
|---------------|-------------------|
| Hardcoded strings | All labels in `exportStrings.ts`, structural test enforces |
| Memory leak from blob URLs | `downloadAsFile` shared utility handles revocation with 200ms delay; structural test checks |
| XSS in markdown output | No HTML emitted, `MarkdownRenderer` sanitizes display, structural test scans for `<` |
| Duplicate download logic | Extracted to `src/shared/utils/fileDownload.ts`, reused by `useDataExport` and `useExportDialog` |
| Wrong Gemini function for polish | Uses `generateContent()` (no context chain); structural test verifies no `generateContentWithContext` in export feature |
| Large file risk | Each service/component is single-responsibility, well under limits |
| Zustand anti-patterns | Only `getState()` calls inside callbacks, no store subscriptions in export services |
| Toast pattern inconsistency | Uses `toast.success()` / `toast.error()` helpers (not raw `addToast`); structural test checks |
| Missing keyboard a11y | Escape closes dialog, backdrop click closes, focus management in modal |
| Security: filename injection | Filename uses `Date.now()` — no user input in download filename |
| Security: clipboard | `writeText()` only — no HTML clipboard, no `write()` with arbitrary blobs |
| Missing analytics | `trackSettingsChanged('branch_export', ...)` for both quick copy and download. **Prerequisite**: Add `'branch_export'` to `SettingKey` union in `analyticsService.ts`, or reuse `'data_export'` with value prefix. |
| Diamond DAG content loss | `collectBranch` inserts cross-reference placeholder when a node is already visited via another path — prevents silent content omission in exported documents |
| Wasted Deck2Actions work | Skipped entirely — Phase 3 deletes dual-deck system; single-node export wired in Phase 3 context menu |
| Phase 1 synthesis nodes ignored | `BranchNode.isSynthesis` + distinct `[Synthesis]` markdown formatting |
| Missing blob revoke delay | Shared utility uses `setTimeout(revokeObjectURL, 200)` matching existing `useDataExport` pattern |

**Net new files**: 14 (8 source + 6 test)
**Files modified**: 4 (strings.ts, SelectionToolbar.tsx, SelectionToolbar.module.css, useDataExport.ts)
**Estimated total new lines**: ~1,200 (source + tests)

---

## Changes from Original Plan (Audit Trail)

| # | Issue | Original | Updated |
|---|-------|----------|---------|
| 1 | Polish uses wrong Gemini function | `generateContentWithContext(prompt, context, '', '')` | `generateContent(prompt)` — simpler, no context chain needed |
| 2 | `AttachmentExport.summary` wrong path | Implied top-level `summary` field | `attachment.extraction?.summary ?? ''` — correct nested path |
| 3 | Toast helper wrong pattern | `useToastStore.getState().addToast()` | `toast.success()` / `toast.error()` — matches codebase convention |
| 4 | Blob URL revoked immediately | "revokes URL after download" | `setTimeout(() => URL.revokeObjectURL(url), 200)` — delay prevents race with browser download |
| 5 | Missing analytics | Not mentioned | `trackSettingsChanged('branch_export', 'download'/'quick_copy')` |
| 6 | Deck2Actions integration (wasted work) | +5 lines to Deck2Actions, +1 to utilsBarLayout, +1 to types, +10 to actions | **Skipped** — Phase 3 deletes dual-deck system entirely. Single-node export wired in Phase 3 context menu. |
| 7 | No quick-copy option | Dialog-only export | **Quick Copy** button on SelectionToolbar: one-click → clipboard → toast. Covers 80% of use cases without modal friction. |
| 8 | Synthesis nodes not recognized | Treated same as regular nodes | `BranchNode.isSynthesis` flag + `[Synthesis]` heading prefix + source count subtitle in markdown output |
| 9 | Duplicate download logic | Inline blob logic in useExportDialog | **Shared utility** `src/shared/utils/fileDownload.ts` extracted from existing `useDataExport.ts`. Both consumers reuse it. |
| 10 | `branchToPlainText` (low value) | Separate plain-text export format | **Removed** — markdown covers all targets (Docs, Notion, email). Reduces code surface. Can add later if needed. |
| 11 | ExportDialog at 95 lines (tight) | Single component | **Extracted** `ExportPreview.tsx` sub-component (~25 lines). Dialog drops to ~70 lines. |
| 12 | useExportDialog at 60 lines (tight) | 60 line estimate | Revised to ~70 lines (realistic for polish toggle + clipboard + download + analytics + error handling) |
| 13 | 6 files modified | Deck2Actions, utilsBarLayout, NodeUtilsBar.types, useIdeaCardActions, SelectionToolbar, strings.ts | **4 files modified** — removed the 4 Deck2Actions-related edits |
| 14 | `trackSettingsChanged('branch_export')` TypeScript error | `'branch_export'` not in `SettingKey` union | **Must add** `'branch_export'` to `SettingKey` in `analyticsService.ts`, or reuse `'data_export'` key |
| 15 | Diamond DAG silently drops content | D appears under B only, lost from C branch | Cross-reference placeholder: `(see above)` inserted under C branch with D's heading |
