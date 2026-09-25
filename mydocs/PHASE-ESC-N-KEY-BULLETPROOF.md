# Bulletproof Keyboard Shortcut & Escape Key Plan

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

This document outlines a phased, test-driven roadmap to ensure that the `Escape` key and the `n`/`N` shortcut are implemented in a completely reliable, maintainable, and debt-free way. It addresses current behaviours, identifies gaps, and prescribes steps to close them with zero anti-patterns.

## Phase 1 – Baseline & audit

1. **Run existing suite.** Confirm `yarn test` passes; capture current behaviour as baseline.
2. **Catalogue behaviours.** Enumerate plain shortcuts (`n`, `Delete`, `Escape`) and modifier shortcuts (`⌘/Ctrl+N`, `⌘+,`, undo/redo). Note escape layer priorities and manual listeners (ExportDialog, SearchBar, TagInput, WorkspaceItem).
3. **Write failing tests for gaps.**
   * Guard plain `n` when any overlay with priority ≥ BAR_OVERFLOW is active.
   * Ensure ExportDialog closes via escape layer and respects priority ordering.

## Phase 2 – Core implementation changes (TDD first)

1. **Overlay guard in global hook.**
   * Add `isAnyOverlayOpen()` helper (inspect escape layer or relevant stores).
   * Modify `handlePlainShortcuts` to early-return when overlays open.
   * Write unit tests covering each overlay type.

2. **Migrate manual Escape handlers.**
   * Replace ExportDialog’s `keydown` listener with `useEscapeLayer(ESCAPE_PRIORITY.MODAL, true, onClose)`.
   * Validate via regression tests that a higher-priority layer suppresses lower ones.
   * Evaluate whether SearchBar/TagInput/WorkspaceItem need migration (likely not).

3. **Quick‑capture race fix (optional).**
   * Add a short lock or cancelable effect to ignore additional `n` presses while the new-node event is pending.
   * Test by firing `⌘+N` followed immediately by `n`.

4. **Remove stray listeners.**
   * Grep for `addEventListener('keydown'` and confirm existing uses are appropriate.
   * Document that all future global listeners should use the hook or escape layer.

## Phase 3 – Expand and harden tests

1. **Integration tests.**
   * Scenarios: settings panel open + `n`, export dialog escape logic with overlapping layers, focus inputs and pressing modifier/non-modifier combos.

2. **Edge‑case stress tests.**
   * Rapid loops for every shortcut.
   * Ensure `GLOBAL_SHORTCUT_KEYS` blocks node-level handlers.

3. **Type‑level checks.** Use `// @ts-expect-error` where appropriate to guard public APIs.

4. **Lint/static analysis.** Run `npm run lint` and address any warnings, apply refactorings if needed.

## Phase 4 – Documentation & developer guidance

1. **Update docs/README.** Add sections:
   * “How to add a new shortcut”
   * Explanation of escape-layer priorities and reserved key set.
   * Test‑first requirement.

2. **Add review/lint reminders.** Consider a checklist item or an ESLint rule for new global shortcuts or escape listeners.

## Phase 5 – Ongoing maintenance

1. **Automate regression detection.** Add e2e tests (Playwright/Cypress) simulating real keyboard input.
2. **Monitor telemetry.** Track suppressed shortcut cases if desired.
3. **Quarterly review.** Update `GLOBAL_SHORTCUT_KEYS` and escape priorities when adding features.
4. **Refactor periodically.** Keep escape priorities centralized, avoid duplicated guards.


### Zero anti‑patterns & zero tech‑debt goals

* Single document listener per purpose.
* No hard-coded key codes; always use `e.key` and constants.
* Centralized guard logic (`isEditableTarget`, `GLOBAL_SHORTCUT_KEYS`, `isAnyOverlayOpen`).
* All behaviours covered by tests before implementation.

Following this plan will result in a robust keyboard UX with minimal risk of regressions or hidden bugs.
