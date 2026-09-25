---
name: css-migrate
description: Migrate a component's CSS Module to Tailwind CSS utilities as part of the incremental migration strategy
---

# CSS → Tailwind Migration

Migrates a **single component's** `.module.css` to Tailwind CSS utilities. Only invoke this when you are already modifying the component's `.tsx` file during production work.

## Usage

```bash
/css-migrate src/features/onboarding/components/HelpButton
/css-migrate src/app/components/OfflineBanner
/css-migrate src/features/search/components/SearchBar
```

## What This Does

1. Reads the component's `.tsx` and its `.module.css`
2. Converts every CSS rule to equivalent Tailwind utility classes
3. Replaces `styles.x` references in the TSX with inline `className` strings
4. Deletes the `.module.css` file
5. Removes the `import styles from '...'` line from the TSX

## Migration Rules

### Design token mapping

Always use CSS variable arbitrary syntax for colors — never Tailwind's built-in palette.
For spacing (`padding`, `margin`, `gap`), use `style` props with CSS variables (arbitrary value spacing classes are overridden by the global `*` reset).

| Our Token | Migration Target |
|---|---|
| `var(--color-primary)` | `bg-[var(--color-primary)]` / `text-[var(--color-primary)]` |
| `var(--color-surface)` | `bg-[var(--color-surface)]` |
| `var(--color-text-primary)` | `text-[var(--color-text-primary)]` |
| `var(--color-border)` | `border-[var(--color-border)]` |
| `var(--space-sm)` → 8px | `style={{ padding: 'var(--space-sm)' }}` or `style={{ padding: 8 }}` |
| `var(--space-md)` → 16px | `style={{ padding: 'var(--space-md)' }}` or `style={{ padding: 16 }}` |
| `var(--space-lg)` → 24px | `style={{ padding: 'var(--space-lg)' }}` or `style={{ padding: 24 }}` |
| `var(--radius-sm)` → 4px | `rounded-sm` |
| `var(--radius-md)` → 8px | `rounded-md` |
| `var(--radius-lg)` → 12px | `rounded-xl` |
| `var(--transition-fast)` | `transition-all duration-150 ease-in-out` |
| `var(--transition-normal)` | `transition-all duration-250 ease-in-out` |
| `var(--shadow-sm)` | `shadow-sm` |
| `var(--shadow-md)` | `shadow-md` |

### Pseudo-class / state variants

```css
/* CSS Module */
.btn:hover { background: var(--color-primary-hover); }
.btn:focus-visible { outline: 2px solid var(--color-primary); }

/* Tailwind */
className="hover:bg-[var(--color-primary-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
```

### Conditional classes — use `clsx`

```tsx
// ❌ WRONG — string template hell
className={`base-class ${isActive ? activeStyle : ''} ${isDisabled ? disabledStyle : ''}`}

// ✅ CORRECT — use clsx (already in project)
import clsx from 'clsx';
className={clsx(
  'base-class px-4 py-2 rounded-md',
  isActive && 'bg-[var(--color-primary)] text-white',
  isDisabled && 'opacity-50 cursor-not-allowed'
)}
```

### Properties that MUST use `style` props (bare global resets override Tailwind)

The global `* { margin: 0; padding: 0 }` and `button { background: none }` resets are bare CSS rules outside any `@layer`. They override ALL corresponding Tailwind utilities. These properties **must** use inline `style` props:

| Property | Why | Example |
|---|---|---|
| `padding` with CSS vars | `* { padding: 0 }` wins | `style={{ padding: 'var(--space-sm)' }}` |
| `margin` with CSS vars or `auto` | `* { margin: 0 }` wins, including `ml-auto` | `style={{ marginLeft: 'auto' }}` |
| `gap` with CSS vars | `* { padding: 0 }` affects gap resolution | `style={{ gap: 'var(--space-xs)' }}` |
| `backgroundColor` on `<button>` | `button { background: none }` wins | `style={{ backgroundColor: 'var(--color-primary)' }}` |
| `color` when element also has `text-[length:...]` | Tailwind v4 ambiguity | `style={{ color: 'var(--color-text-primary)' }}` |

### `overflow-hidden` → `overflow-clip` on fixed-height containers

**Never use `overflow-hidden` on modals, panels, dialogs, or any fixed-height container.** CSS `overflow: hidden` clips visually but still allows the browser to programmatically scroll the element when focus moves to a child (`sr-only` radio, hidden input). This creates a blank gap at the bottom.

Use `overflow-clip` instead — it prevents both visual overflow AND focus-triggered scrolling.

```tsx
// ❌ BROKEN — focus-scroll shifts content, creates blank gap
<div className="h-[600px] flex flex-col overflow-hidden rounded-xl">

// ✅ CORRECT — no scroll possible
<div className="h-[600px] flex flex-col overflow-clip rounded-xl">
```

`overflow-clip` preserves `border-radius` clipping identically to `overflow-hidden`.

Use `overflow-hidden` ONLY for: text truncation (`overflow-hidden text-ellipsis`) or containers whose height equals their content height.

**Hover states for buttons with inline `backgroundColor`:** Create a CSS class in a co-located `.css` file:
```css
.my-btn:hover:not(:disabled) {
    background-color: var(--color-primary-hover) !important;
}
```

Export co-located `*_STYLE` constants alongside className constants in a shared `*Styles.ts` file.

### What to SKIP — leave in a local `style` prop or keep as CSS

- `position: absolute` with dynamic `top`/`left` values from JS state → keep as `style={{ top, left }}`
- Complex `@keyframes` animations → keep in `global.css` or a shared animation CSS file
- `::-webkit-scrollbar` custom scrollbars → keep in CSS
- `transform` values computed from JS (e.g. ReactFlow transforms) → keep as `style={{}}`
- Any canvas-layer component (`IdeaCard`, `CanvasView`, node/edge files) → **do not migrate yet**

## Files That Must NEVER Be Migrated

```
src/styles/variables.css        ← Design token source of truth
src/styles/global.css           ← Resets and body/html rules
src/styles/themes/*.css         ← Runtime theme switching via :root overrides
src/styles/semanticZoom.css     ← Viewport-level canvas rules
```

## Verification Checklist After Migration

- [ ] `import styles from '...'` line removed from `.tsx`
- [ ] `.module.css` file deleted
- [ ] All `styles.x` references replaced (grep for `styles\.` in the file — should be zero)
- [ ] No Tailwind built-in palette colors used (grep for `bg-blue-`, `text-gray-` etc.)
- [ ] Theme-sensitive colors use `var(--color-*)` arbitrary syntax
- [ ] Component renders correctly in light, dark, sepia, and grey themes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes

## Example Migration

**Before** — `HelpButton.module.css`:
```css
.helpButton {
  position: fixed;
  bottom: var(--space-lg);
  right: var(--space-lg);
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-text-on-primary);
  box-shadow: var(--shadow-md);
  transition: box-shadow var(--transition-fast);
}
.helpButton:hover {
  box-shadow: var(--shadow-lg);
}
```

**After** — `HelpButton.tsx` (no `.module.css`):
```tsx
<button
  className="fixed w-9 h-9 rounded-full
             shadow-md transition-shadow duration-150 ease-in-out
             hover:shadow-lg help-btn"
  style={{
    bottom: 'var(--space-lg)',
    right: 'var(--space-lg)',
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-text-on-primary)',
  }}
>
```
Note: `bottom`/`right` use `style` for CSS var spacing. `backgroundColor` and `color` use `style` because `<button>` has a bare global reset. Non-spacing Tailwind utilities (`rounded-full`, `shadow-md`, `hover:shadow-lg`) work fine via className.

---

**Reference**: See `CLAUDE.md` → `🎨 CSS → TAILWIND INCREMENTAL MIGRATION` for full strategy.
