# Phase 11 (Revised): Reader Workspace for BASB (PDF/Image First, Security-First)

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

## Summary

This is the complete replacement plan for Phase 11.

- Scope locked: PDF/Image reader first.
- Link preview click behavior stays external by default.
- Web iframe reader is deferred (CSP and cross-origin constraints).
- Reader lifecycle stays in focus mode.
- High-frequency reader UI state uses local `useReducer` (isolated dispatch chain from canvas store).
- Reader opens are allowed only through a typed safe-URL contract at API boundaries.
- Async viewer work is session-scoped (`sessionId` + cancellation) to prevent stale writes.
- Quote insertion is single-transaction, undo-safe, and idempotent per session.
- Each phase has strict quality gates: TDD, integration coverage, full lint/typecheck/tests.

## Incorporated Findings (Ordered by Severity)

1. Critical CSP conflict resolved by removing web iframe scope from Phase 11.
2. URL safety moved from checklist-only to compile-time and runtime API boundary.
3. Async race risk resolved with explicit session and cancellation contract.
4. Quote insertion upgraded from markdown-string insertion to deterministic ProseMirror transaction insertion.
5. Link preview default behavior preserved (external open remains primary).
6. PDF rendering constrained to paged mode with measurable, testable performance constraints.
7. Error/recovery and accessibility criteria made explicit and test-gated.
8. Test scope expanded to match FocusOverlay and editor lifecycle complexity.

## Public Interfaces and Type Contracts

### Reader source types for Phase 11

```ts
type SafeReaderUrl = string & { readonly __brand: 'SafeReaderUrl' };

type ReaderSource =
  | {
      type: 'pdf';
      url: SafeReaderUrl;
      filename: string;
      sourceId: string;
      mime: 'application/pdf';
    }
  | {
      type: 'image';
      url: SafeReaderUrl;
      filename: string;
      sourceId: string;
      mime: `image/${string}`;
    };
```

### Safe URL contract (single source of truth)

- `toSafeReaderUrl(raw: string): SafeReaderUrl | null`
- `SafeReaderUrl` can be produced only by `toSafeReaderUrl`.
- Accept only `https:` URLs from trusted origins:
- current app origin
- explicitly configured attachment CDN/storage origins
- signed attachment URLs are allowed only when host is trusted.
- Reject `javascript:`, `data:`, `file:`, and any malformed URL.
- All reader open paths must fail closed (`null` -> no open, show safe fallback).

### Focus store additions

- `readerContext: { nodeId: string; source: ReaderSource; sessionId: number } | null`
- `openReader(nodeId: string, source: ReaderSource): { sessionId: number }`
- `closeReader(reason: 'escape' | 'user' | 'navigation'): void`

### Async lifecycle contract

- `openReader` increments `sessionId` monotonically.
- Viewer load/select/quote effects carry `sessionId` and `AbortController`.
- Close or source-switch aborts in-flight work and invalidates prior sessions.
- Any async result with stale `sessionId` is ignored.

### Reader local reducer (UI state only, no canvas store writes)

State:
- `paneSide`
- `splitRatio`
- `currentPage`
- `selectionDraft`
- `loadState` (`idle` | `loading` | `ready` | `error` | `blocked`)
- `isQuotePending`

Actions:
- `SET_SPLIT`
- `FLIP_PANES`
- `SET_PAGE`
- `SET_SELECTION`
- `CLEAR_SELECTION`
- `SET_LOAD_STATE`
- `SET_QUOTE_PENDING`

### Attachment extension callback contract

- `nodeId` passed via extension options.
- `resolveReaderSource(attachment): ReaderSource | null` validates mime + URL and builds typed source.
- `onOpenReader?: (nodeId: string, source: ReaderSource) => void`

### Quote insertion contract

Insert ProseMirror nodes, not raw markdown, in one transaction:
- `blockquote` node with selected text.
- attribution paragraph with localized visible text (`filename`, `page`).
- attribution node attrs for machine-readable metadata (`sourceId`, `nodeId`, `page`, `sourceType`).
- Guardrails:
- normalize whitespace and sanitize selection text.
- max quote length guard.
- disable duplicate insertion while `isQuotePending` is true.
- dedupe same `(sourceId, page, normalizedSelectionHash)` within active session.
- Undo/redo must treat quote insertion as one editor step.

### Error and recovery contract

- Explicit load states and UX copy for:
- corrupt/password-protected PDF
- expired or unavailable URL
- network fetch/render failure
- Recovery actions:
- retry current source
- open externally (safe fallback)
- return focus to note editor without leaving focus mode

### Accessibility acceptance contract

- Reader shell:
- logical tab order and visible focus ring on all controls
- Escape closes reader first, then focus mode
- close reader restores focus to triggering attachment action
- Splitter:
- keyboard support (`Arrow` +/- 5%, `Home` 20%, `End` 80%)
- announced value and orientation via ARIA
- Viewer and note panes have labeled regions for screen readers.

## Phase-Wise Plan

## Phase 11.1: Reader Core Shell (No Source-Specific Viewer)

### Build

- Add typed safe URL utility and trusted-origin config constants.
- Add `readerContext` to focus store with `openReader`/`closeReader` and `sessionId`.
- Branch FocusOverlay rendering:
- default focus editor when `readerContext` is null
- reader shell when `readerContext` exists
- Implement reader shell layout controls and split ratio handling.
- Keep split/pane/page/selection/load state in local reducer.
- Add escape handling order: close reader first, then exit focus.
- Add session invalidation and cancellation hooks for future source viewers.
- Use string resources and CSS variables only.

### TDD and integration

- Unit tests for focus store reader transitions and monotonic `sessionId`.
- Unit tests for reducer action semantics and split clamping.
- Unit tests for `toSafeReaderUrl` accepted/rejected cases.
- Integration test: FocusOverlay switches modes correctly.
- Integration test: Escape priority behavior is correct with editor/focus layers.
- Integration test: stale async callback cannot update closed/switched reader session.

### Phase gate

- `npm run typecheck`
- `npm run lint:strict`
- `npm run test`
- `npm run check`

### Tech debt policy for this phase

Incurred debt allowed:
- Temporary adapter props during FocusOverlay split refactor.

Debt removal before phase close:
- Remove adapter props and duplicate constants.
- No `TODO` or `FIXME` left.
- New/changed files under 300 lines via extraction.
- Stale-closure risks audited and removed.
- No direct/raw URL writes into store API.

## Phase 11.2: Attachment Entry and Reader Wiring (PDF/Image Only)

### Build

- Add `Open in reader` action to attachment card.
- Action is shown only for supported mimes and valid safe URLs.
- Pass node identity and reader callback through `AttachmentExtension.configure`.
- Build `ReaderSource` via `resolveReaderSource` (single validation path).
- Preserve existing attachment actions (`download`, `open in new tab`, `remove`).
- Do not change link preview primary click behavior.
- On blocked/invalid source, show safe non-breaking feedback and keep editor usable.

### TDD and integration

- Unit test: attachment action invokes reader callback with typed payload.
- Unit test: unsupported mime does not expose reader action.
- Unit test: invalid URL is blocked and does not call `openReader`.
- Integration test: attachment click opens reader context and reader shell.
- Integration test: existing attachment actions remain unchanged.

### Phase gate

- `npm run typecheck`
- `npm run lint:strict`
- `npm run test`
- `npm run check`

### Tech debt policy for this phase

Incurred debt allowed:
- Temporary callback wrappers while extension options are threaded.

Debt removal before phase close:
- Remove duplicate URL validation paths; retain one SSOT utility.
- Remove bridge wrappers once typed wiring is complete.
- Reconfirm selector-only Zustand usage in touched components.

## Phase 11.3: PDF Viewer and Quote-to-Note Pipeline

### Build

- Implement paged PDF viewer with selectable text layer for current page.
- Keep rendered page cache bounded (`current`, `prev`, `next` only).
- Show contextual `Add quote` action for non-empty PDF selection.
- Insert quote using one ProseMirror transaction:
- `blockquote` for quote body
- attribution paragraph with visible localized metadata
- attribution attrs with machine-readable metadata
- Add quote sanitization and max length guard.
- Add quote idempotency guards (`isQuotePending` and selection fingerprint).
- Handle error states (corrupt/password/expired/network) with retry and external-open fallback.
- Keep store writes deterministic and one-shot.

### TDD and integration

- Unit test: quote formatter and attribution builder (visible + attrs).
- Unit test: selection normalization, hash/dedupe, and max-length behavior.
- Unit test: quote insertion produces a single transaction step.
- Integration test: select text -> add quote -> editor updates once.
- Integration test: rapid double-trigger of add quote inserts only once.
- Integration test: undo/redo reverts and reapplies quote in one step.
- Integration test: rapid source switch drops stale PDF callbacks by `sessionId`.
- Integration test: focus/blur/escape lifecycle remains correct.
- Integration test: large PDF paging does not cause render-loop regressions.

### Performance gate (must be testable)

- At most one visible text layer and one visible page canvas in DOM at any time.
- Bounded page cache size of three.
- No React update-depth warnings or repeated render loop signatures during page flip stress test.

### Phase gate

- `npm run typecheck`
- `npm run lint:strict`
- `npm run test`
- `npm run check`

### Tech debt policy for this phase

Incurred debt allowed:
- Temporary text selection helpers while page model stabilizes.

Debt removal before phase close:
- Consolidate quote formatting in one service (SSOT).
- Remove debug selection/page code.
- Run effect dependency audit to eliminate update-depth loop risk.

## Phase 11.4: Image Reader Pane and UX/Accessibility Hardening

### Build

- Add image source pane with contained rendering and scroll-safe behavior.
- Keep note editor live beside image source.
- Implement keyboard and accessibility requirements from the acceptance contract.
- Add analytics events:
- `reader_opened`
- `reader_closed`
- `reader_quote_inserted`
- `reader_source_type`
- Include `sessionId`, `sourceType`, `result`, and `reason` fields.
- Never include raw URL, selected quote text, or other sensitive payloads.
- Enforce safe URL usage for all reader source opens.

### TDD and integration

- Unit test: image source rendering states and safe URL guard paths.
- Integration test: image attachment -> open reader -> close reader flow.
- Integration test: no regression in global keyboard shortcuts and escape stack.
- Integration test: focus restore to trigger works after close.
- Integration test: keyboard splitter semantics (`Arrow`, `Home`, `End`) update ratio correctly.
- Accessibility test: pane regions and controls expose required labels/roles.
- Structural tests for string/color compliance on touched files.

### Phase gate

- `npm run typecheck`
- `npm run lint:strict`
- `npm run test`
- `npm run check`

### Tech debt policy for this phase

Incurred debt allowed:
- Temporary analytics wrappers during event schema stabilization.

Debt removal before phase close:
- Remove temporary wrappers and keep one analytics helper.
- Remove duplicated labels and enforce localization SSOT.
- Verify new reader module files are under 300 lines.

## Phase 11.5: Release Stabilization (Mandatory Final Phase)

### Build

- Run full regression sweep across canvas editing, focus mode, attachments, and shortcuts.
- Security regression checklist:
- no CSP weakening
- no unsafe HTML insertion
- no unsanitized URL open paths
- no bypass path around `toSafeReaderUrl`
- trusted-origin list is enforced and unit-tested
- Verify Zustand selector discipline in reader path.
- Verify local reducer dispatch chain remains isolated from canvas store.
- Stress test rapid open/close/switch flows for stale callback safety.

### TDD and integration

- Integration test: attachment -> reader -> quote -> save -> reopen -> content persisted.
- Integration test: invalid reader URL is blocked with safe fallback behavior.
- Integration test: stale async result cannot write after close or source switch.
- Re-run all existing suites and ensure no behavioral regressions.

### Phase gate

- `npm run typecheck`
- `npm run lint:strict`
- `npm run test`
- `npm run check`

### Tech debt policy for this phase

Incurred debt allowed:
- None.

Debt removal before phase close:
- Zero open debt policy: remove transitional APIs, dead code, duplicated constants, and temporary guards.
- Update phase doc and follow-up docs to match implemented behavior and non-goals.

## Better Alternative Paths (Post-Phase 11)

## Path A (Recommended): Web Reader via Extracted Content (Phase 12)

- Build server-side URL extraction and sanitization pipeline.
- Render extracted article text in reader pane.
- Enable reliable web quote capture without iframe/CSP fragility.

## Path B (Not recommended near-term): iframe Web Reader

- Requires CSP expansion and ongoing embed-failure UX work.
- Still cannot reliably capture text selection across origins.
- Higher maintenance risk with lower reliability.

## Global Engineering Constraints (Always On)

- Maintain MVVM, DRY, SOLID, SSOT.
- No hardcoded user-facing strings.
- No hardcoded colors; use universal color scheme variables.
- No Zustand anti-patterns (selector subscriptions only).
- No ReactFlow cascade risk from reader interactions.
- No stale-closure effect bugs.
- Zero lint errors in every phase.
- Cyber security compliance in all new/updated code paths.
- One-shot reducer dispatch chain isolated from canvas store for reader UI state.
- All reader opens must pass through `toSafeReaderUrl` with no bypass.
- All async reader side effects must enforce `sessionId` stale-result dropping.
- Accessibility bar for touched reader surfaces is WCAG 2.2 AA equivalent behavior.

## Assumptions and Defaults

- Phase 11 supports only attachment-based reader sources (`pdf`, `image`).
- Link preview cards keep external-open as primary behavior.
- No Firestore schema changes in Phase 11.
- Reader session state is ephemeral UI state.
- Persisted artifact remains node note content plus structured attribution attrs in editor document.

## Decisions Applied from Review

- Trusted origin policy: allow only `https` URLs from app origin and configured attachment origins.
- Interaction safety policy: rapid repeated open/close/switch is supported and race-safe by design.
- Metadata policy: quote attribution is both human-readable and machine-readable for reliable downstream features.
