---
name: test
description: Run specific test files or patterns with optional watch/coverage mode
disable-model-invocation: true
allowed-tools: Bash(npx vitest:*)
---

# Test Runner

Run Vitest for specific files, directories, or patterns. Supports watch mode and coverage reporting.

## Usage

- `/test` — Run all tests
- `/test useNodeResize` — Run tests matching pattern "useNodeResize"
- `/test src/features/canvas` — Run tests in directory
- `/test --watch` — Run in watch mode
- `/test --coverage` — Run with coverage report
- `/test src/features/workspace/__tests__/useWorkspaceLoader.test.ts` — Run specific file

## Examples

```
/test IdeaCard          # All IdeaCard-related tests
/test --watch           # Watch mode for development
/test --coverage        # Generate coverage report
```

## Exit Codes

- `0` = All tests passed
- `1` = Test failures
- Check output for detailed failure information

Execute: `npx vitest run $ARGUMENTS`
