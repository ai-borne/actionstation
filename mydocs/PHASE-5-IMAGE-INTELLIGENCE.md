# Phase 5: Image Intelligence (Simplified)

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

## Problem Statement

Users upload images to nodes (screenshots, diagrams, whiteboard photos) but the AI cannot "see" them. Only text documents trigger the Document Intelligence pipeline. For a knowledge work canvas, this is a significant blind spot -- visual artifacts are a core part of how people capture information. A photo of a whiteboard from a meeting, a screenshot of a design mockup, or a chart from a report all contain rich information that the AI should understand and synthesize.

## Intended Solution

Extend the existing document analysis pipeline to handle images. No new UI paradigms -- images follow the exact same flow as documents: upload -> AI describes -> insight node spawns. The existing `autoAnalyzeDocuments` toggle and premium gate apply to images too. This is a pipeline extension, not a new feature.

**What we deliberately skip** (vs. original plan):
- No SparkleIcon component (auto-spawn works, same as documents)
- No toolbar toggle duplication (settings toggle is sufficient)
- No "documents" -> "attachments" rename (18-file churn for a label change)
- No `hasExtraction` / `insightSpawned` transient TipTap attributes
- No `AttachmentMeta` for images (images live as `<img>` in TipTap, not as attachment nodes)

**Result**: ~4 production files changed. Same user value.

## Architecture Decision

- **No new feature module** -- extends existing `documentAgent` and `canvas` features
- **Reuses entire existing pipeline**: `analyzeAndSpawn` handles all gating, analysis, and node spawning
- **Image -> text bridge**: `describeImageWithAI()` produces a text description that feeds into `analyzeAndSpawn` as `parsedText`
- **No `AttachmentMeta` for images**: Images are tracked as `<img>` nodes in TipTap (via `imageExtension`), NOT as `AttachmentMeta` entries. Documents use `AttachmentMeta` because they render via a custom `attachment` NodeView. Forcing images into `AttachmentMeta` creates dual-tracking (TipTap `<img>` + `node.data.attachments`) with no cleanup when the image is deleted from the editor.
- **SSOT for MIME types**: Reuses `IMAGE_ACCEPTED_MIME_TYPES` from `src/features/canvas/types/image.ts` -- no duplicate whitelists
- **Security**: MIME validated against existing whitelist before Gemini API call; `sanitizeFilename` on user-provided names

---

## Sub-phase 5A: Fix imageDescriptionService MIME Bug + Validation

### What We Build

Fix the hardcoded `'image/jpeg'` MIME type in `imageDescriptionService.ts` to use the actual blob MIME type, and add whitelist validation.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/knowledgeBank/services/imageDescriptionService.ts` | EDIT | +10 lines |
| `src/features/knowledgeBank/services/__tests__/imageDescriptionService.test.ts` | EDIT | +25 lines |

### Implementation

**Current (buggy)**:
```typescript
const body = buildVisionRequestBody(prompt, base64Data, 'image/jpeg');
```

**Fixed**:
```typescript
import { IMAGE_ACCEPTED_MIME_TYPES } from '@/features/canvas/types/image';

const ALLOWED_IMAGE_MIMES: ReadonlySet<string> = new Set(IMAGE_ACCEPTED_MIME_TYPES);

export async function describeImageWithAI(blob: Blob, filename: string): Promise<string> {
    const fallback = `${strings.knowledgeBank.imageDescriptionFallback}: ${filename}`;

    // Reject empty or unsupported MIME types
    if (!blob.type || !ALLOWED_IMAGE_MIMES.has(blob.type)) {
        return fallback;
    }

    if (!isGeminiAvailable()) return fallback;

    try {
        const base64Data = await blobToBase64(blob);
        const prompt = strings.knowledgeBank.imageDescriptionPrompt;
        const body = buildVisionRequestBody(prompt, base64Data, blob.type);
        const result = await callGemini(body);
        if (!result.ok) return fallback;
        return extractGeminiText(result.data) ?? fallback;
    } catch {
        return fallback;
    }
}
```

**Key decisions**:
- **SSOT**: `ALLOWED_IMAGE_MIMES` derived from `IMAGE_ACCEPTED_MIME_TYPES` (single source in `image.ts`)
- **Empty `blob.type` rejected**: Not silently treated as JPEG. Empty type = programmatically constructed blob = suspicious input. Return fallback instead.
- **Never-throws contract preserved**: Unsupported MIME returns fallback (same as Gemini failure). Callers don't need try/catch for this function.
- **No separate `parseImageForAnalysis` wrapper**: This function IS the image parsing service. Adding a wrapper in `documentParsingService.ts` violates SRP (that file is a PDF/text parser with pdfjs-dist dependency).

### TDD Tests

```
1. PNG blob -> mimeType sent as 'image/png' to buildVisionRequestBody
2. JPEG blob -> mimeType sent as 'image/jpeg' to buildVisionRequestBody
3. WebP blob -> mimeType sent as 'image/webp' to buildVisionRequestBody
4. GIF blob -> mimeType sent as 'image/gif' to buildVisionRequestBody
5. Empty blob.type -> returns fallback (not sent to API)
6. Unsupported MIME 'image/svg+xml' -> returns fallback
7. Unsupported MIME 'application/pdf' -> returns fallback
8. ALLOWED_IMAGE_MIMES derived from IMAGE_ACCEPTED_MIME_TYPES (structural)
```

### Tech Debt Checkpoint

- [ ] File stays under 300 lines
- [ ] MIME whitelist from SSOT (`image.ts`), not duplicated
- [ ] Never-throws contract maintained
- [ ] No `any` types
- [ ] String resources used for fallback message
- [ ] Zero lint errors

---

## Sub-phase 5B: Thread File + URL Through Image Insert Callback

### What We Build

Modify the image insert callback chain to pass `file` and `permanentUrl` to the `onAfterInsert` callback, enabling downstream analysis.

### Why This Is Needed

The current callback chain:
```
insertImageIntoEditor(editor, file, uploadFn, onAfterInsert)
  -> uploads file -> gets permanentUrl
  -> onAfterInsert?.()  // ZERO arguments!
```

The plan needs `file` and `permanentUrl` in the callback to trigger image analysis. Without this change, `handleAfterImageInsert` in `useIdeaCardImageHandlers.ts` has no access to the file blob (needed for Gemini Vision).

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/services/imageInsertService.ts` | EDIT | ~5 lines changed |
| `src/features/canvas/hooks/useImageInsert.ts` | EDIT | ~2 lines changed |
| `src/features/canvas/services/__tests__/imageInsertService.test.ts` | EDIT | +10 lines |

### Implementation

**`imageInsertService.ts`** -- widen callback signature:

```typescript
// Before:
export async function insertImageIntoEditor(
    editor: Editor | null,
    file: File,
    uploadFn: ImageUploadFn,
    onAfterInsert?: () => void,
): Promise<void> {
    // ... upload logic ...
    try { onAfterInsert?.(); } catch { /* ... */ }
}

// After:
export type AfterImageInsertFn = (file: File, permanentUrl: string) => void;

export async function insertImageIntoEditor(
    editor: Editor | null,
    file: File,
    uploadFn: ImageUploadFn,
    onAfterInsert?: AfterImageInsertFn,
): Promise<void> {
    // ... upload logic ...
    try { onAfterInsert?.(file, permanentUrl); } catch { /* ... */ }
}
```

**`useImageInsert.ts`** -- update type:

```typescript
// Before:
export function useImageInsert(editor: Editor | null, uploadFn: ImageUploadFn, onAfterInsert?: () => void)

// After:
import type { AfterImageInsertFn } from '../services/imageInsertService';
export function useImageInsert(editor: Editor | null, uploadFn: ImageUploadFn, onAfterInsert?: AfterImageInsertFn)
```

**Backward compatibility**: The existing call site in `useIdeaCardImageHandlers.ts` currently passes a zero-arg callback. TypeScript allows calling a function that accepts `(file, url)` with `() => ...` (extra params are ignored). But we update the caller in 5C anyway, so no issue.

### TDD Tests

```
1. insertImageIntoEditor calls onAfterInsert with (file, permanentUrl) after successful upload
2. insertImageIntoEditor does not call onAfterInsert on upload failure
3. onAfterInsert error does not affect upload success path (existing behavior preserved)
4. onAfterInsert receives the sanitized permanent URL (not the base64 data URL)
```

### Tech Debt Checkpoint

- [ ] imageInsertService stays under 300 lines (currently 112 + 5 = 117)
- [ ] useImageInsert stays under 300 lines (currently 44 + 2 = 46)
- [ ] AfterImageInsertFn exported as named type (no inline signatures)
- [ ] Existing tests still pass (callback behavior preserved)
- [ ] Zero lint errors

---

## Sub-phase 5C: Wire Image Upload to Analysis Pipeline

### What We Build

After an image is uploaded, describe it with AI and feed the description into `analyzeAndSpawn` to create an insight node.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/hooks/useIdeaCardImageHandlers.ts` | EDIT | +15 lines |
| `src/features/canvas/hooks/__tests__/useIdeaCardImageHandlers.imageAnalysis.test.ts` | NEW | ~80 lines |

### Implementation

**`useIdeaCardImageHandlers.ts`** -- extend `handleAfterImageInsert`:

```typescript
import { describeImageWithAI } from '@/features/knowledgeBank/services/imageDescriptionService';
import { sanitizeFilename } from '@/shared/utils/sanitize';
import type { AfterImageInsertFn } from '../services/imageInsertService';

// Inside the hook:
const handleAfterImageInsert: AfterImageInsertFn = useCallback((file, _permanentUrl) => {
    // 1. Persist markdown with newly inserted image
    const md = getMarkdown();
    if (md) useCanvasStore.getState().updateNodeOutput(id, md);

    // 2. Early-exit: skip analysis if auto-analyze is disabled or user is not premium.
    //    This check BEFORE describeImageWithAI avoids wasting a Gemini Vision API call
    //    (and user quota) when the feature is turned off.
    const autoAnalyze = useSettingsStore.getState().autoAnalyzeDocuments;
    if (!autoAnalyze) return;

    // 3. Trigger image analysis (async, non-blocking)
    const workspaceId = useWorkspaceStore.getState().currentWorkspaceId;
    if (!workspaceId) return;

    const safeFilename = sanitizeFilename(file.name);

    void (async () => {
        // describeImageWithAI never throws -- returns fallback on failure
        const imageDescription = await describeImageWithAI(file, safeFilename);
        // analyzeAndSpawn checks premium gate internally
        await analyzeAndSpawn(id, imageDescription, safeFilename, workspaceId);
    })().catch((e: unknown) =>
        captureError(e instanceof Error ? e : new Error(String(e))),
    );
}, [id, getMarkdown, analyzeAndSpawn]);
```

**Key decisions**:
- **No `AttachmentMeta` created**: Images are not documents. They're already tracked as `<img>` nodes in TipTap via `imageExtension`. Creating a parallel `AttachmentMeta` entry would mean:
  - User deletes image from editor -> orphaned `AttachmentMeta` in `node.data.attachments`
  - `AttachmentMeta.sizeBytes` is required but not relevant for embedded images
  - `AttachmentMeta.thumbnailUrl` / `parsedTextUrl` are document-specific fields
  - Document re-analysis (`/analyze-document` slash command) checks `attachments` array, would incorrectly pick up images
- **Image inserted FIRST** (instant visual feedback, handled by `insertImageIntoEditor`)
- **Early-exit before API call**: `autoAnalyzeDocuments` setting checked BEFORE calling `describeImageWithAI`. This avoids wasting a Gemini Vision API call (and user quota) when auto-analyze is disabled. The previous design called `describeImageWithAI` unconditionally, then `analyzeAndSpawn` would return early — but the Vision API call was already made.
- **Analysis triggered SECOND** (async, non-blocking, fires and forgets)
- **`describeImageWithAI` never throws** -- even on Gemini failure, it returns a fallback string. That fallback still feeds into `analyzeAndSpawn`, which may produce a less useful insight node. This is acceptable: the alternative (silently doing nothing) gives zero value.
- **`sanitizeFilename`** strips path separators and special characters from user-provided `file.name`
- **`analyzeAndSpawn` stability**: This function is returned from `useDocumentAgent()` hook. Verify it is memoized internally (wrapped in `useCallback`). If not, the `handleAfterImageInsert` callback will be recreated on each render due to `analyzeAndSpawn` in its dependency array. **Mitigation**: If `analyzeAndSpawn` is not stable, capture it in a `useRef` to avoid re-render cascades: `const analyzeAndSpawnRef = useRef(analyzeAndSpawn); analyzeAndSpawnRef.current = analyzeAndSpawn;` and call `analyzeAndSpawnRef.current(...)` inside the callback.

### TDD Tests

```
1. Image upload -> updateNodeOutput called with current markdown
2. Image upload -> describeImageWithAI called with file blob and sanitized filename
3. Image upload -> analyzeAndSpawn called with image description as parsedText
4. Image upload -> sanitizeFilename applied to file.name
5. autoAnalyzeDocuments=false -> describeImageWithAI NOT called (early-exit before API call, saves quota)
6. Non-premium user -> analyzeAndSpawn returns early (internal check, but describeImageWithAI still called since premium check is inside analyzeAndSpawn)
7. describeImageWithAI returns fallback -> analyzeAndSpawn still called (fallback is valid input)
8. analyzeAndSpawn throws -> error captured by Sentry, no unhandled rejection
9. No workspaceId -> analysis skipped, no error
10. No AttachmentMeta created (node.data.attachments unchanged)
```

### Tech Debt Checkpoint

- [ ] useIdeaCardImageHandlers stays under 300 lines (currently 107 + 15 = 122)
- [ ] No `any` types
- [ ] `sanitizeFilename` on file.name
- [ ] Non-blocking: image insertion succeeds regardless of analysis outcome
- [ ] No Zustand anti-patterns (all reads via `getState()` inside callback)
- [ ] No `AttachmentMeta` pollution (images tracked only in TipTap)
- [ ] Zero lint errors

---

## Sub-phase 5D: Integration + Structural Tests

### What We Build

End-to-end test verifying the complete image upload -> describe -> analyze -> insight node flow, plus structural safety checks.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/canvas/__tests__/imageAnalysis.integration.test.ts` | NEW | ~90 lines |
| `src/features/canvas/__tests__/imageAnalysis.structural.test.ts` | NEW | ~40 lines |

### Integration Test

```typescript
describe('Image Analysis Pipeline -- end to end', () => {

  test('image upload with auto-analyze ON -> creates insight node', async () => {
    // Setup:
    // - Mock settingsStore: autoAnalyzeDocuments = true
    // - Mock subscription: premium = true
    // - Mock describeImageWithAI: returns "A whiteboard showing project timeline..."
    // - Mock analyzeDocument: returns extraction result
    // - Create parent node in canvas store

    // Act:
    // - Simulate image upload (call handleAfterImageInsert with file and url)

    // Assert:
    // 1. describeImageWithAI called with file blob
    // 2. analyzeAndSpawn called with image description as parsedText
    // 3. New insight node created in canvas store
    // 4. New edge connects parent -> insight node
    // 5. Insight node output contains extraction content
    // 6. node.data.attachments is UNCHANGED (no AttachmentMeta for images)
  });

  test('image upload with auto-analyze OFF -> no analysis, no API call', async () => {
    // Setup: autoAnalyzeDocuments = false
    // Act: simulate image upload
    // Assert:
    // 1. describeImageWithAI NOT called (early-exit BEFORE API call — saves Gemini quota)
    // 2. analyzeAndSpawn NOT called
    // 3. No insight node created
    // 4. updateNodeOutput still called (markdown saved regardless)
  });

  test('image upload with non-premium user -> description called but no insight node', async () => {
    // Setup: premium = false, autoAnalyzeDocuments = true
    // Act: simulate image upload
    // Assert:
    // 1. describeImageWithAI IS called (auto-analyze is ON, so we pass the early check)
    // 2. analyzeAndSpawn IS called but returns early internally (premium gate)
    // 3. No insight node created
    // 4. updateNodeOutput still called
  });

  test('Gemini Vision unavailable -> fallback description -> still analyzes', async () => {
    // Setup: isGeminiAvailable() returns false
    // Act: simulate image upload
    // Assert:
    // 1. describeImageWithAI returns fallback string
    // 2. analyzeAndSpawn called with fallback string
    // 3. Insight node still created (from fallback description analysis)
    //    The insight may be less useful, but something > nothing
  });

  test('image + existing document attachments -> attachments untouched', async () => {
    // Setup: node already has a PDF AttachmentMeta in data.attachments
    // Act: upload image
    // Assert: node.data.attachments still has only the PDF entry
  });
});
```

### Structural Test

```typescript
describe('Image Analysis structural safety', () => {

  test('imageDescriptionService uses blob.type, not hardcoded MIME', () => {
    // Read imageDescriptionService.ts source
    // Verify buildVisionRequestBody receives blob.type (not a string literal)
  });

  test('ALLOWED_IMAGE_MIMES derived from IMAGE_ACCEPTED_MIME_TYPES (SSOT)', () => {
    // Read imageDescriptionService.ts source
    // Verify import from canvas/types/image
    // No duplicate whitelist array
  });

  test('sanitizeFilename used on image filenames in handler', () => {
    // Grep useIdeaCardImageHandlers.ts for sanitizeFilename
  });

  test('No AttachmentMeta created for images', () => {
    // Grep useIdeaCardImageHandlers.ts for 'AttachmentMeta' -- should NOT match
    // Grep useIdeaCardImageHandlers.ts for 'updateNodeAttachments' -- should only appear
    // in the existing document handler context, not in handleAfterImageInsert
  });

  test('autoAnalyzeDocuments checked BEFORE describeImageWithAI call', () => {
    // Read useIdeaCardImageHandlers.ts source
    // Verify autoAnalyzeDocuments check appears before describeImageWithAI call
    // This ensures no wasted Gemini Vision API call when feature is disabled
  });

  test('All modified files under 300 lines', () => {
    // wc -l check on all modified files
  });
});
```

### Tech Debt Checkpoint

- [ ] All tests pass (including existing document analysis tests -- no regression)
- [ ] Integration test covers: auto-analyze on/off, premium/free, Gemini up/down
- [ ] Structural test prevents MIME SSOT drift and AttachmentMeta creep
- [ ] Zero lint errors

---

## Sub-phase 5E: String Resources (if needed)

### What We Build

Verify string coverage for the image analysis path. Add missing strings only.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/shared/localization/canvasStrings.ts` | EDIT | +1-2 lines (if needed) |

### Audit

**Already exists** (no change needed):
- `canvasStrings.imageUnsupportedType` -- "Unsupported image format. Use JPEG, PNG, GIF, or WebP."

**Potentially needed** (only if we surface analysis status to user):
```typescript
imageAnalyzing: 'Analyzing image...',
```

**NOT needed** (the plan's original `imageAnalysisFailed` string):
- `describeImageWithAI` never throws, so there's no user-facing "analysis failed" path for the description step
- `analyzeAndSpawn` already has its own error toasts (`strings.documentAgent.analysisFailed`)
- Adding a dead string is tech debt

### Tech Debt Checkpoint

- [ ] All error messages from string resources (grep audit of modified files)
- [ ] No orphan strings added (every string used somewhere)
- [ ] Zero lint errors

---

## Build Gate Checklist (Full Phase 5)

```bash
npx tsc --noEmit          # zero errors
npm run lint               # zero errors
npm run test               # ALL pass (including all existing document/image tests)

# File size audit:
wc -l src/features/knowledgeBank/services/imageDescriptionService.ts  # < 300
wc -l src/features/canvas/services/imageInsertService.ts              # < 300
wc -l src/features/canvas/hooks/useIdeaCardImageHandlers.ts           # < 300

# Security audit:
grep -n "sanitizeFilename" src/features/canvas/hooks/useIdeaCardImageHandlers.ts  # present
grep -n "IMAGE_ACCEPTED_MIME_TYPES" src/features/knowledgeBank/services/imageDescriptionService.ts  # present (SSOT import)

# Zustand audit:
grep -rn "useCanvasStore()" src/features/canvas/hooks/useIdeaCardImageHandlers.ts  # empty (no bare calls)

# SSOT audit:
grep -rn "ALLOWED_IMAGE_MIMES\|IMAGE_ANALYSIS_MIME_TYPES" src/  # only in imageDescriptionService (derived from image.ts)
```

---

## Phase 5 Tech Debt Audit

| Potential Debt | How We Prevented It |
|---------------|-------------------|
| MIME type duplication | Single SSOT: `IMAGE_ACCEPTED_MIME_TYPES` in `image.ts`, imported everywhere |
| Hardcoded 'image/jpeg' (the original bug) | Structural test verifies `blob.type` usage + whitelist import |
| Empty blob.type bypass | Explicitly rejected (returns fallback), not silently treated as JPEG |
| AttachmentMeta/image dual-tracking | Images stay in TipTap only; no `AttachmentMeta` created for images |
| Callback signature mismatch | `AfterImageInsertFn` type exported, threading `file` + `url` through chain |
| Analysis blocking image insertion | Non-blocking `void async` pattern; image always appears regardless |
| Missing error messages | All paths use existing `canvasStrings` / `documentAgent` strings |
| Zustand anti-patterns | All store reads inside callbacks use `getState()` |
| SRP violation in documentParsingService | No image logic added to PDF/text parser; `describeImageWithAI` called directly |
| Regression on document analysis | Existing document tests run unchanged; pipeline extended, not modified |
| Wasted API call when auto-analyze OFF | Early-exit check: `autoAnalyzeDocuments` read from `useSettingsStore.getState()` BEFORE calling `describeImageWithAI`. Saves Gemini Vision quota when feature is disabled. |
| `analyzeAndSpawn` callback instability | If `useDocumentAgent()` doesn't memoize `analyzeAndSpawn`, capture in `useRef` to prevent re-render cascade. Structural test should verify stable reference or ref pattern. |

---

## Summary: Changes Overview

**Production files modified**: 3
1. `imageDescriptionService.ts` -- MIME fix + validation (5A)
2. `imageInsertService.ts` -- callback signature widened (5B)
3. `useIdeaCardImageHandlers.ts` -- analysis wiring (5C)

**Production files with minimal touch**: 1
4. `useImageInsert.ts` -- callback type update (5B)

**Possibly**: 1
5. `canvasStrings.ts` -- 1 string if we add analysis toast (5E)

**Test files new**: 3
- `imageDescriptionService.test.ts` (extended)
- `useIdeaCardImageHandlers.imageAnalysis.test.ts` (new)
- `imageAnalysis.integration.test.ts` + `imageAnalysis.structural.test.ts` (new)

**Files NOT modified** (vs. original plan):
- `document.ts` -- no type widening needed (no `AnalyzableMimeType`)
- `documentParsingService.ts` -- no `parseImageForAnalysis` wrapper (SRP preserved)

**Estimated total new lines**: ~270 (mostly tests)
**Estimated modified lines**: ~30 in production code
