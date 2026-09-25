---
name: build
description: Build the project and run all verification checks (types, lint, tests)
disable-model-invocation: true
allowed-tools: Bash(npm run:*, npx:*)
---

# Build & Verify

Run the complete build pipeline with all quality checks. This is what CI runs.

## Pipeline Steps

1. **Type Check** (`npx tsc --noEmit`)
   - ✓ All TypeScript types valid
   - ✗ Stop on type errors

2. **ESLint** (`npm run lint`)
   - ✓ Zero errors (may have ≤49 warnings)
   - ✗ Stop on linting errors

3. **Tests** (`npx vitest run`)
   - ✓ All tests pass (2800+ tests expected)
   - ✗ Stop on test failures

4. **Build** (`npm run build`)
   - ✓ Vite bundle succeeds
   - ✗ Stop on build errors

5. **Quality Audit**
   - ✓ No files exceed 300 lines
   - ✓ No functions exceed 50 lines
   - ✓ No components exceed 100 lines
   - ✓ All strings from `strings.ts` (no hardcoded values)
   - ✓ All CSS via variables (no hardcoded colors)

## Usage

- `/build` — Run full pipeline
- `/build --quick` — Skip tests (type check + lint + build only)

## Success Criteria

```
✓ Type check passed
✓ Lint passed (0 errors)
✓ Tests passed
✓ Build succeeded
✓ Quality audit passed
```

## Failure Recovery

If a step fails:
1. Read the error output carefully
2. Identify the file and line number
3. Fix the issue
4. Re-run `/build` to verify

## Time Expectations

- Full pipeline: ~45 seconds
- Quick mode: ~15 seconds

Execute pipeline:
```bash
echo "=== TYPE CHECK ===" && npx tsc --noEmit && \
echo "=== LINT ===" && npm run lint && \
echo "=== TESTS ===" && npx vitest run && \
echo "=== BUILD ===" && npm run build && \
echo "✓ All checks passed!"
```

**Note**: Must pass before pushing to `feature/intmoat` or creating PR.
