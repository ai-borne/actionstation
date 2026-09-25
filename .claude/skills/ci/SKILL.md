---
name: ci
description: Simulate the complete GitHub CI/CD pipeline locally before pushing
disable-model-invocation: true
allowed-tools: Bash(npm:*, npx:*, git:*)
---

# CI Pipeline Simulator

Simulate the exact CI/CD pipeline that runs on GitHub Actions before you push. This is what happens on `feature/intmoat` → `main` workflow.

## Pipeline Stages

### Stage 1: Dependency Install (if needed)
```bash
npm ci  # Clean install (production-like)
```

### Stage 2: Type Safety
```bash
npx tsc --noEmit  # TypeScript compiler
```
- ✓ Must pass
- ✗ Blocks all downstream stages

### Stage 3: Code Quality
```bash
npm run lint  # ESLint
```
- ✓ Zero errors required
- ⚠️ ≤49 warnings allowed
- ✗ Errors block build

### Stage 4: Testing
```bash
npx vitest run  # Full test suite
```
- ✓ All tests must pass (2800+ expected)
- ✓ 2 skipped tests allowed (expected)
- ✗ Any failure blocks build

### Stage 5: Production Build
```bash
npm run build  # Vite bundle
```
- ✓ dist/ folder generated
- ✗ Build errors block deployment

## Usage

- `/ci` — Run complete pipeline (all stages)
- `/ci --fast` — Skip tests (types + lint + build only for quick feedback)
- `/ci --from typecheck` — Resume from specific stage

## Exit Behavior

**Success**:
```
✓ All stages passed
✓ Ready for push to GitHub
```

**Failure**:
```
✗ Stage X failed (stops pipeline)
  Error details above
  Fix and re-run: /ci
```

## How This Maps to GitHub Actions

| What | Local Command | GitHub Workflow |
|------|---------------|-----------------|
| Type check | `npx tsc` | `.github/workflows/preview.yml` |
| Lint | `npm run lint` | `.github/workflows/preview.yml` |
| Test | `npx vitest run` | `.github/workflows/preview.yml` |
| Build | `npm run build` | `.github/workflows/preview.yml` |
| Deploy | `firebase deploy` | `.github/workflows/deploy.yml` (main only) |

## Time Expectations

- **Full pipeline**: ~45 seconds
- **Fast mode** (--fast): ~15 seconds
- **GitHub CI**: ~3-5 minutes (includes more checks)

## Pre-Push Checklist

Before `git push origin feature/intmoat`:

- [ ] `/ci` passes all stages
- [ ] No new files > 300 lines
- [ ] No functions > 50 lines
- [ ] No hardcoded strings/colors
- [ ] All strings from `strings.ts`
- [ ] All CSS via variables
- [ ] Test coverage adequate
- [ ] Commit message follows `type(scope): description` format
- [ ] No merge conflicts with main

## Common CI Failures

| Error | Cause | Fix |
|-------|-------|-----|
| `TS7006` | Missing type annotation | Add `: Type` |
| `TS2322` | Type mismatch | Check assignment types |
| ESLint errors | Code style violation | Run `npm run lint --fix` |
| Test failures | Broken functionality | Run `/test --watch` to debug |
| Build chunk warning | Large JS chunk | Code-split using `React.lazy()` |

## Recovering from CI Failure

1. **Read error message** - identify file:line
2. **Fix locally** - make changes
3. **Re-run `/ci`** - verify fix
4. **Commit changes** - `git add` and `git commit`
5. **Push** - `git push origin feature/intmoat`

---

**Note**: Running `/ci` locally saves time by catching issues before GitHub CI runs them (which adds 3-5 min of queue time).
