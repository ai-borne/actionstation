---
name: review
description: Audit changed files for code quality, CLAUDE.md compliance, and tech debt
---

# Code Review

Review recently changed files (or specified files) for adherence to CLAUDE.md rules and code quality standards.

## Usage

- `/review` — Auto-review files changed in last commit
- `/review src/features/canvas/components/nodes/IdeaCard.tsx` — Review specific file
- `/review src/features/workspace/hooks` — Review a directory
- `/review --strict` — Fail on any warning (not just errors)

## Checks Performed

### File Structure (CLAUDE.md STRICT LIMITS)

- ✓ File size ≤ 300 lines (split if larger)
- ✓ Function size ≤ 50 lines (extract helpers)
- ✓ Component size ≤ 100 lines (create sub-components)
- ✓ Hook size ≤ 75 lines (split by responsibility)

### Architecture (MVVM + Feature-First)

- ✓ Files follow `types/` → `stores/` → `hooks/` → `components/` → `__tests__/` pattern
- ✓ Each feature self-contained (SSOT per domain)
- ✓ No cross-feature coupling (only via types)
- ✓ Services for side effects (distinct from stores)

### String Resources (ZERO HARDCODING)

- ✗ No hardcoded strings in JSX (use `strings.ts`)
- ✗ No hardcoded error messages
- ✗ No hardcoded labels/tooltips

Example:
```typescript
// ❌ BAD
<button>Submit</button>

// ✅ GOOD
import { strings } from '@/shared/localization/strings';
<button>{strings.common.submit}</button>
```

### CSS & Styling (NO HARDCODING + TAILWIND MIGRATION)

- ✗ No hardcoded colors (use `--color-*` CSS variables or `bg-[var(--color-*)]` in Tailwind)
- ✗ No hardcoded dimensions (use `--spacing-*` or Tailwind spacing scale)
- ✗ No hardcoded fonts (use CSS variables)
- ✗ No new `.module.css` files created for any component
- ✗ No mixed styling: if a component has been touched, it must be **fully** on Tailwind or **fully** on CSS Module — never both
- ✗ No Tailwind built-in palette colors (e.g. `bg-blue-500`) — always use `bg-[var(--color-primary)]`
- ✓ `src/styles/variables.css`, theme files, and `global.css` are **never** migrated

**Tailwind migration check — when touching a `.tsx` file:**
1. Does it still `import styles from '*.module.css'`? → Must migrate the module CSS now
2. Does it mix `styles.x` class with Tailwind utilities? → Violation — go all-in on Tailwind

Example:
```typescript
// ❌ BAD — hardcoded value
style={{ color: '#3b82f6', padding: '16px' }}

// ❌ BAD — mixed: Module CSS + Tailwind in same component
import styles from './Button.module.css';
<button className={`${styles.btn} mt-4`}>...</button>

// ✅ GOOD — legacy (unmigrated component, not yet touched)
className={styles.primaryButton}  // Uses CSS variables in its .module.css

// ✅ GOOD — fully migrated to Tailwind
<button className="mt-4 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg">
```

### Performance (ReactFlow 500+ Nodes)

- ✓ Custom nodes wrapped with `React.memo()`
- ✓ Selectors used (never bare destructuring from Zustand)
- ✓ No `getNodeMap` inside selectors (prevents closure variables)
- ✓ `useMemo`/`useCallback` for expensive operations
- ✓ Event handlers not recreated every render

### Zustand Patterns (NO ANTI-PATTERNS)

- ✓ **Selector pattern**: `const x = useStore((s) => s.x)` ✓
- ✗ Bare destructuring: `const { x } = useStore()` ✗
- ✓ Actions via getState: `useStore.getState().setX()` ✓
- ✗ No closure variables in selectors (causes drag lag)

Example:
```typescript
// ❌ WRONG - causes "Maximum update depth exceeded"
const { nodes, edges } = useCanvasStore();

// ✅ CORRECT
const nodes = useCanvasStore((s) => s.nodes);
const edges = useCanvasStore((s) => s.edges);
```

### Testing (TDD PROTOCOL)

- ✓ Critical paths have ≥60% coverage
- ✓ Stores have ≥90% coverage
- ✓ Hooks have ≥80% coverage
- ✓ Services have ≥85% coverage
- ✓ Utils have 100% coverage

### Security

- ✓ No hardcoded API keys (use environment variables)
- ✓ Input validation at system boundaries
- ✓ XSS prevention (React safe by default)
- ✓ CSRF protection on forms
- ✓ Secure Firestore rules (deny-all default)

### Documentation

- ✓ Public functions have JSDoc comments
- ✓ Complex logic explained (why, not what)
- ✓ Type definitions self-documenting
- ✓ No TODO/FIXME comments (fix or remove)

## Report Format

Outputs:
```
✓ File: src/features/canvas/components/nodes/IdeaCard.tsx
  Size: 98 lines ✓

✓ Strings: All from strings.ts
✓ CSS: All CSS variables
✓ Performance: React.memo applied
✓ Zustand: Selectors used correctly
✓ Tests: 85% coverage

✗ Issue: Function handleNodeDrag is 67 lines (max 50)
   → Extract event handlers to separate hook

Status: ⚠️ REVIEW REQUIRED (1 issue, 0 blockers)
```

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| File > 300 lines | Split into feature modules |
| Function > 50 lines | Extract helpers/middleware |
| Hardcoded strings | Use `strings.ts` import |
| No React.memo | Wrap with `React.memo()` |
| Bare Zustand destructuring | Use selectors: `(s) => s.field` |
| getNodeMap in selector | Extract: `useMemo(() => getNodeMap(nodes).get(id), [nodes, id])` |
| Missing tests | Write RED test first (TDD) |
| Mixed CSS Module + Tailwind | Finish migration — remove `.module.css`, use Tailwind only |
| New `.module.css` created | Delete it — use Tailwind utilities instead |
| Tailwind built-in palette color | Replace with `bg-[var(--color-*)]` arbitrary syntax |
| Hardcoded color/dimension in style prop | Use `var(--color-*)` or Tailwind utility |

---

**Reference**: See `CLAUDE.md` for complete rules. This review enforces all of them.
