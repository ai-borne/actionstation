---
name: lint-fix
description: Run ESLint to identify and fix code style/quality violations
disable-model-invocation: true
allowed-tools: Bash(npm run lint:*)
---

# Lint & Fix

Run ESLint across the project or specific files. Automatically fixes violations where possible.

## Usage

- `/lint-fix` — Lint entire project
- `/lint-fix src/features/canvas` — Lint a directory
- `/lint-fix src/App.tsx` — Lint a specific file
- `/lint-fix --fix` — Auto-fix all fixable violations (default behavior)

## Rules Enforced

Per `CLAUDE.md`:
- ✓ No `any` types in production
- ✓ Zustand selector pattern (no bare destructuring)
- ✓ No `getNodeMap` inside selectors (prevents closure variables)
- ✓ String resources via `strings.ts` (no hardcoded strings)
- ✓ CSS variables for all colors/dimensions
- ✓ React.memo for custom nodes
- ✓ No floating promises (use `void fn().catch()` or await)

## Output

Shows:
- Error count / Warning count
- File-by-file violations
- Specific rules triggered
- Suggested fixes

Execute: `npm run lint`

**Note**: Zero errors required before commit. Warnings must stay ≤49.
