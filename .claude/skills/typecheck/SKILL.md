---
name: typecheck
description: Run TypeScript compiler to check for type errors
disable-model-invocation: true
allowed-tools: Bash(npx tsc:*)
---

# Type Check

Run TypeScript type checking without emitting JavaScript. Catches type errors before runtime.

## Usage

- `/typecheck` — Check entire project for type errors
- `/typecheck --noEmit` — Check without generating .js files (faster)
- `/typecheck --listFiles` — Show all analyzed files (verbose, debugging)

## What It Checks

- ✓ No implicit `any` types
- ✓ Missing type annotations
- ✓ Type mismatches in function calls
- ✓ Property access on wrong types
- ✓ Zustand store type compatibility
- ✓ React component prop types
- ✓ Async/await promise chain typing

## Common Errors

| Error | Meaning | Fix |
|-------|---------|-----|
| `TS7006` | Parameter lacks type annotation | Add `: Type` after param name |
| `TS2322` | Type mismatch in assignment | Check types match or cast with `as` |
| `TS2531` | Cannot access property on possibly null | Use optional chaining `?.` or guard |
| `TS2339` | Property doesn't exist on type | Check spelling or type definition |

## Exit Codes

- `0` = No type errors
- `>0` = Type errors found

Execute: `npx tsc --noEmit`

**Note**: Must pass before build. No type errors allowed.
