---
name: migration-verify
description: Verify a completed CSS-to-Tailwind migration wave — runs type/lint/test checks, detects orphaned CSS imports, forbidden patterns, and security anti-patterns
---

# Migration Verify

Post-wave verification skill for the CSS → Tailwind migration program. Run after completing each wave to confirm correctness.

## Usage

```
/migration-verify wave1
/migration-verify wave2
```

## Verification Steps

### 1. Build Pipeline

Run the full check pipeline and production build:

```bash
npm run check   # typecheck + lint + test
npm run build   # production build must succeed
```

### 2. Orphaned CSS Import Detection

Grep migrated components for leftover CSS Module imports:

```bash
# For each migrated component file, verify:
rg "import styles from" <component-file>    # should return ZERO matches
rg "styles\." <component-file>              # should return ZERO matches
```

### 3. Deleted CSS File Verification

Confirm the `.module.css` files were actually deleted:

```bash
# Each .module.css listed in the wave should NOT exist
ls <path-to-deleted-css-file>  # should fail with "No such file"
```

### 4. Forbidden Tailwind Pattern Detection

Scan migrated component files for banned patterns:

```bash
# No Tailwind built-in palette — must use var(--color-*) arbitrary syntax
rg "bg-(red|blue|green|yellow|gray|slate|zinc|neutral|stone|orange|amber|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-" <file>
rg "text-(red|blue|green|yellow|gray|slate|zinc|neutral|stone|orange|amber|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-" <file>
rg "border-(red|blue|green|yellow|gray|slate|zinc|neutral|stone|orange|amber|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-" <file>

# No mixed Module CSS + Tailwind in same component
# (component should NOT import any .module.css AND have className="..." Tailwind)
```

### 5. Security Anti-Pattern Detection

```bash
# No dynamic className from user input
rg "className=\{.*userInput\b" <file>
rg "className=\{.*props\.\w+\}" <file>  # check manually for user-controlled props

# No dangerouslySetInnerHTML for style injection
rg "dangerouslySetInnerHTML" <file>
```

### 6. Bundle Size Check

```bash
# After npm run build, compare dist/ output sizes
du -sh dist/
ls -la dist/assets/*.css  # CSS bundle should shrink
ls -la dist/assets/*.js   # JS bundle should stay stable
```

### 7. Structural Test Check

If any structural tests reference deleted CSS files, they must have been updated in the same wave:

```bash
rg "\.module\.css" src/__tests__/ src/features/*/__tests__/
```

### 8. CSS Variable Existence Check

Every `var(--*)` reference must resolve to a token defined in `src/styles/variables.css` or a theme file.

```bash
# Extract all var() references from migrated files
rg "var\(--[^)]+\)" <migrated-file> -o | sort -u

# Cross-reference each against variables.css + theme files
# Any var() not found = broken styling that silently falls back to browser defaults
```

### 9. Shorthand Variable Misuse Check

CSS variables holding multi-property shorthands cannot be used with single-property Tailwind utilities.

Known shorthand variables to watch for:
- `--glass-border` → `1px solid hsla(...)` — must use `style={{ border: 'var(--glass-border)' }}`
- `--glass-bg` → `hsla(...)` — safe as single-value in `bg-[var(--glass-bg)]`
- `--sidebar-transition` → `250ms ease` — must NOT use in `duration-[var(--sidebar-transition)]` (duration only takes time)

```bash
rg "border-\[var\(--glass-border\)\]" <migrated-file>   # should be ZERO
rg "duration-\[var\(--sidebar-transition\)\]" <migrated-file>  # should be ZERO
```

### 10. Font-Size Type Hint Check

Font-size tokens in `text-[...]` must use the `length:` type hint to prevent Tailwind from interpreting them as colors.

```bash
# Should be ZERO — missing type hint causes color interpretation
rg 'text-\[var\(--font-size-' <migrated-file>

# Should have matches — correct usage
rg 'text-\[length:var\(--font-size-' <migrated-file>
```

### 11. Visual Smoke Test

After each wave, visually inspect all migrated components in the running app:
- Light + dark + sepia + grey themes
- Pinned + unpinned sidebar
- Compact mode toggle
- Button hover/focus states

## Pass/Fail Report Format

```
=== Wave N Migration Verification ===
[PASS/FAIL] Build pipeline (typecheck + lint + test + build)
[PASS/FAIL] No orphaned CSS imports in migrated components
[PASS/FAIL] All .module.css files deleted
[PASS/FAIL] No forbidden Tailwind palette colors
[PASS/FAIL] No mixed CSS Modules + Tailwind
[PASS/FAIL] No security anti-patterns
[PASS/FAIL] Structural tests updated (if applicable)
[PASS/FAIL] All var(--*) references resolve to defined tokens
[PASS/FAIL] No shorthand variable misuse (border-[var(--glass-border)] etc.)
[PASS/FAIL] Font-size tokens use length: type hint
[PASS/FAIL] Visual smoke test (light/dark/sepia/grey, pinned/unpinned, compact)
[INFO]      Bundle size: CSS XXkB / JS XXkB
```
