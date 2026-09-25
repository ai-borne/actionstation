# Phase 9: Workspace Templates & Quick Start — No Blank Canvas Anxiety

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

## Problem Statement

Every new workspace starts as an empty canvas. For new users, this is intimidating — they have a powerful tool but no idea where to begin. For experienced users, it's repetitive — they recreate the same thinking structures (project plan, research canvas, brainstorm board) every time. BASB's CODE methodology (Capture, Organize, Distill, Express) provides a natural framework, but the app doesn't guide users toward it. A template system solves both problems: new users get a starting point that teaches the workflow, and experienced users skip setup.

## Intended Solution

A **template picker** that appears when creating a new workspace. Users choose from 5 built-in templates or "Blank canvas." Each template pre-populates 3-8 connected nodes with placeholder text that demonstrates a thinking pattern. Templates are **client-side only** — defined as static JSON structures, no server storage needed. Users can also **save a workspace as a template** for personal reuse.

## Architecture Decisions

- **New feature module**: `src/features/templates/` (types, services, components, strings)
- **No new Zustand store** — template picker is a modal with local `useReducer` state; creation flow is async in the hook
- **Templates are static typed JSON** — defined in `templateDefinitions.ts`, each template is an array of `TemplateNode` + `TemplateEdge` with relative positions
- **ID generation**: Template nodes use placeholder IDs (`'n1'`, `'n2'`). On instantiation, all IDs are remapped via `crypto.randomUUID()`. No `Date.now()`.
- **Custom templates**: Saved to `localStorage` as `WorkspaceTemplate[]` serialised as JSON. Validated on read with Zod schema to prevent XSS / malicious data injection. Limited to 10 custom templates.
- **Security**: `getCustomTemplates()` validates parsed data through Zod (`customTemplatesSchema`) before returning. `saveAsTemplate()` validates `name` via `tagNameSchema` (already in `schemas.ts`). Input sanitisation is mandatory.
- **No Firestore for templates** — localStorage is sufficient for personal reuse. Multi-device sync can be added later as a Firestore subcollection.
- **Creation flow**: Template picker opens first (no workspace created yet) → user selects → workspace is created → template is instantiated with the new workspaceId → nodes/edges saved via `workspaceService` → canvas switches
- **Analytics**: `trackTemplateUsed(templateId, isCustom)` — a new typed function in `analyticsService.ts`, NOT added to `SettingKey` (which tracks settings changes, not feature usage)
- **Escape layer**: `TemplatePicker` uses `useEscapeLayer(ESCAPE_PRIORITY.MODAL, isOpen, onClose)` (priority 80)
- **CSS variables**: All CSS uses `--color-*` family exclusively — no `--surface-primary` or `--text-primary`
- **Strings**: `templateStrings.ts` in feature folder; imported into `strings.ts` as `strings.templates` (strings.ts is safe at ~297 lines after Phase 7 added `onboarding`)

---

## Sub-phase 9A: Template Types & Definitions

### What We Build

Type definitions, Zod validation schemas, 5 built-in template structures, and all string resources.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/templates/types/template.ts` | NEW | ~35 |
| `src/features/templates/services/templateDefinitions.ts` | NEW | ~90 |
| `src/features/templates/services/templateSchemas.ts` | NEW | ~40 |
| `src/features/templates/services/__tests__/templateDefinitions.test.ts` | NEW | ~55 |
| `src/features/templates/strings/templateStrings.ts` | NEW | ~45 |

### Implementation

**`template.ts`** (~35 lines):

```typescript
import type { NodeColorKey } from '@/features/canvas/types/node';

export interface WorkspaceTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: TemplateCategory;
  readonly nodes: TemplateNode[];
  readonly edges: TemplateEdge[];
  readonly isCustom: boolean;
}

export type TemplateCategory = 'basb' | 'project' | 'creative' | 'research' | 'custom';

export interface TemplateNode {
  readonly templateId: string;            // placeholder ID, remapped on instantiation
  readonly heading: string;
  readonly output: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly colorKey: NodeColorKey;
}

export interface TemplateEdge {
  readonly sourceTemplateId: string;
  readonly targetTemplateId: string;
}

export const MAX_CUSTOM_TEMPLATES = 10;
export const CUSTOM_TEMPLATES_STORAGE_KEY = 'custom_templates';
```

**`templateSchemas.ts`** (~40 lines) — Zod schemas for localStorage validation:

```typescript
import { z } from 'zod';

const templateNodeSchema = z.object({
  templateId: z.string().min(1).max(64),
  heading:    z.string().max(500),
  output:     z.string().max(5000),
  position:   z.object({ x: z.number(), y: z.number() }),
  colorKey:   z.enum(['default', 'danger', 'warning', 'success', 'synthesis']),
});

const templateEdgeSchema = z.object({
  sourceTemplateId: z.string().min(1).max(64),
  targetTemplateId: z.string().min(1).max(64),
});

const workspaceTemplateSchema = z.object({
  id:          z.string().min(1).max(128),
  name:        z.string().min(1).max(100),
  description: z.string().max(500),
  category:    z.enum(['basb', 'project', 'creative', 'research', 'custom']),
  isCustom:    z.boolean(),
  nodes:       z.array(templateNodeSchema).max(50),
  edges:       z.array(templateEdgeSchema).max(200),
});

export const customTemplatesSchema = z.array(workspaceTemplateSchema).max(10);
export type ValidatedTemplate = z.infer<typeof workspaceTemplateSchema>;
```

**`templateDefinitions.ts`** (~90 lines) — Factory helpers keep definitions compact:

```typescript
import type { TemplateNode, TemplateEdge } from '../types/template';
import { templateStrings as s } from '../strings/templateStrings';

// Compact factories: 1 line per node / edge
const n = (
  id: string, heading: string, x: number, y: number,
  colorKey: NodeColorKey = 'default'
): TemplateNode => ({ templateId: id, heading, output: '', position: { x, y }, colorKey });

const e = (src: string, tgt: string): TemplateEdge =>
  ({ sourceTemplateId: src, targetTemplateId: tgt });

export const BUILT_IN_TEMPLATES: WorkspaceTemplate[] = [
  {
    id: 'basb-code', name: s.basb.name, description: s.basb.description,
    category: 'basb', isCustom: false,
    nodes: [
      n('n1', s.basb.capture,  0,   0, 'success'),
      n('n2', s.basb.organize, 350, 0, 'success'),
      n('n3', s.basb.distill,  700, 0, 'success'),
      n('n4', s.basb.express,  1050,0, 'success'),
    ],
    edges: [e('n1','n2'), e('n2','n3'), e('n3','n4')],
  },
  {
    id: 'project-kickoff', name: s.project.name, description: s.project.description,
    category: 'project', isCustom: false,
    nodes: [
      n('n1', s.project.goal,      350, 150, 'warning'),
      n('n2', s.project.scope,     0,   0  ),
      n('n3', s.project.timeline,  700, 0  ),
      n('n4', s.project.risks,     0,   300),
      n('n5', s.project.resources, 700, 300),
    ],
    edges: [e('n1','n2'), e('n1','n3'), e('n1','n4'), e('n1','n5')],
  },
  {
    id: 'research-canvas', name: s.research.name, description: s.research.description,
    category: 'research', isCustom: false,
    nodes: [
      n('n1', s.research.question,  350, 0  ),
      n('n2', s.research.sub1,      0,   200),
      n('n3', s.research.sub2,      350, 200),
      n('n4', s.research.sub3,      700, 200),
      n('n5', s.research.source1,   0,   400),
      n('n6', s.research.source2,   700, 400),
    ],
    edges: [e('n1','n2'), e('n1','n3'), e('n1','n4'), e('n2','n5'), e('n4','n6')],
  },
  {
    id: 'brainstorm', name: s.brainstorm.name, description: s.brainstorm.description,
    category: 'creative', isCustom: false,
    nodes: [
      n('n1', s.brainstorm.idea, 0,   0),   n('n2', s.brainstorm.idea, 350, 0),
      n('n3', s.brainstorm.idea, 700, 0),   n('n4', s.brainstorm.idea, 0,   220),
      n('n5', s.brainstorm.idea, 350, 220), n('n6', s.brainstorm.idea, 700, 220),
      n('n7', s.brainstorm.idea, 0,   440), n('n8', s.brainstorm.idea, 350, 440),
    ],
    edges: [], // divergent thinking — no connections yet
  },
  {
    id: 'weekly-review', name: s.review.name, description: s.review.description,
    category: 'basb', isCustom: false,
    nodes: [
      n('n1', s.review.happened, 0,   0, 'default'),
      n('n2', s.review.learned,  350, 0, 'default'),
      n('n3', s.review.next,     700, 0, 'default'),
      n('n4', s.review.actions,  1050,0, 'success'),
    ],
    edges: [e('n1','n2'), e('n2','n3'), e('n3','n4')],
  },
];
```

### TDD Tests (8)

```
1.  Each built-in template has a unique `id`
2.  Each template has at least 2 nodes
3.  All edge source/target IDs reference valid node `templateId`s in the same template
4.  All headings are non-empty strings
5.  All positions are { x: number, y: number }
6.  Template categories are valid TemplateCategory values
7.  No duplicate template IDs across BUILT_IN_TEMPLATES
8.  customTemplatesSchema validates a valid template array (and rejects bad data)
```

### Tech Debt Checkpoint

- [ ] `template.ts` under 40 lines
- [ ] `templateDefinitions.ts` under 95 lines (factory helpers are essential)
- [ ] `templateSchemas.ts` under 45 lines
- [ ] All heading/description text from `templateStrings.ts`
- [ ] `strings.ts` remains under 300 lines after adding `templates` key
- [ ] Zero lint errors

---

## Sub-phase 9B: Template Instantiation Service

### What We Build

A pure function that takes a template definition and produces real `CanvasNode[]` + `CanvasEdge[]` with proper UUIDs. Defensive against missing IDs — no non-null assertions.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/templates/services/templateInstantiator.ts` | NEW | ~50 |
| `src/features/templates/services/__tests__/templateInstantiator.test.ts` | NEW | ~75 |

### Implementation

**`templateInstantiator.ts`** (~50 lines):

```typescript
import type { WorkspaceTemplate } from '../types/template';
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';
import { DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '@/features/canvas/types/node';

export interface InstantiatedTemplate {
  readonly nodes: CanvasNode[];
  readonly edges: CanvasEdge[];
}

export function instantiateTemplate(
  template: WorkspaceTemplate,
  workspaceId: string
): InstantiatedTemplate {
  const idMap = new Map<string, string>();
  for (const tNode of template.nodes) {
    idMap.set(tNode.templateId, `idea-${crypto.randomUUID()}`);
  }

  const now = new Date();

  const nodes: CanvasNode[] = template.nodes.map((tNode) => {
    const id = idMap.get(tNode.templateId);
    if (!id) throw new Error(`Template integrity error: missing ID for "${tNode.templateId}"`);
    return {
      id,
      type: 'idea' as const,
      position: tNode.position,
      workspaceId,
      createdAt: now,
      updatedAt: now,
      data: {
        heading: tNode.heading,
        output:  tNode.output,
        tags:    [],
        colorKey: tNode.colorKey,
        width:   DEFAULT_NODE_WIDTH,
        height:  DEFAULT_NODE_HEIGHT,
      },
    };
  });

  // Only create edges where both endpoints resolved — silently drop orphaned edges
  const edges: CanvasEdge[] = template.edges.flatMap((tEdge) => {
    const source = idMap.get(tEdge.sourceTemplateId);
    const target = idMap.get(tEdge.targetTemplateId);
    if (!source || !target) return []; // corrupt edge — drop, don't throw
    return [{ id: `edge-${crypto.randomUUID()}`, source, target }];
  });

  return { nodes, edges };
}
```

> **Why no `!` non-null assertions**: Template data arriving from `getCustomTemplates()` is Zod-validated but edge/node cross-references could theoretically be corrupt if the schema ever relaxes. The defensive check + explicit error (for nodes) or silent drop (for edges) gives safe runtime behaviour without masking bugs.

### TDD Tests (10)

```
1.  All template node IDs replaced with crypto.randomUUID() format
2.  No template placeholder IDs remain in output nodes or edges
3.  Edge source/target reference new node IDs (not placeholder IDs)
4.  All nodes have workspaceId set correctly
5.  All nodes have createdAt and updatedAt set
6.  Node positions match template positions
7.  Headings and outputs copied from template
8.  Empty template (0 nodes, 0 edges) produces empty arrays
9.  Orphaned edge (reference to missing templateId) is silently dropped
10. Two separate instantiations of the same template produce different UUIDs
```

### Tech Debt Checkpoint

- [ ] `templateInstantiator.ts` under 55 lines
- [ ] Pure function (no side effects, no store access, no Firestore)
- [ ] No `!` non-null assertions — defensive checks with clear error messages
- [ ] `crypto.randomUUID()` for all IDs (never `Date.now()`)
- [ ] Zero lint errors

---

## Sub-phase 9C: Template Picker Modal

### What We Build

A modal that appears when creating a new workspace, showing template cards to choose from. Wires into `WorkspacePoolButton` (the actual workspace-creation component).

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/templates/components/TemplatePicker.tsx` | NEW | ~85 |
| `src/features/templates/components/TemplatePicker.module.css` | NEW | ~60 |
| `src/features/templates/components/TemplateCard.tsx` | NEW | ~45 |
| `src/features/templates/components/TemplateCard.module.css` | NEW | ~30 |
| `src/features/templates/components/__tests__/TemplatePicker.test.tsx` | NEW | ~75 |
| `src/features/templates/index.ts` | NEW | ~5 |
| `src/features/workspace/components/WorkspacePoolButton.tsx` | EDIT | Add `useTemplatePicker` hook; open picker before creating workspace |
| `src/shared/services/analyticsService.ts` | EDIT | Add `trackTemplateUsed(templateId, isCustom)` function |

### Implementation

**`TemplatePicker.tsx`** (~85 lines) — modal shell:

```typescript
interface TemplatePickerProps {
  readonly customTemplates: WorkspaceTemplate[];
  readonly onSelect: (template: WorkspaceTemplate | null) => void;
  readonly onClose: () => void;
}

export const TemplatePicker = React.memo(function TemplatePicker(props: TemplatePickerProps) {
  useEscapeLayer(ESCAPE_PRIORITY.MODAL, true, props.onClose);

  const allTemplates = [...BUILT_IN_TEMPLATES, ...props.customTemplates];

  return createPortal(
    <div className={styles.backdrop} onClick={props.onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={strings.templates.pickerTitle}
        onClick={(e) => e.stopPropagation()} // prevent backdrop close on inner click
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{strings.templates.pickerTitle}</h2>
          <button className={styles.closeBtn} onClick={props.onClose}
                  aria-label={strings.common.close}>✕</button>
        </div>
        <div className={styles.grid}>
          {allTemplates.map((t) => (
            <TemplateCard key={t.id} template={t} onSelect={props.onSelect} />
          ))}
          <TemplateCard template={null} onSelect={props.onSelect} />  {/* Blank Canvas */}
        </div>
      </div>
    </div>,
    document.body
  );
});
```

**`TemplateCard.tsx`** (~45 lines):

```typescript
interface TemplateCardProps {
  readonly template: WorkspaceTemplate | null; // null = blank canvas
  readonly onSelect: (t: WorkspaceTemplate | null) => void;
}

export const TemplateCard = React.memo(function TemplateCard({ template, onSelect }: TemplateCardProps) {
  const isBlank = template === null;
  const name = isBlank ? strings.templates.blankCanvas : template.name;
  const desc = isBlank ? strings.templates.blankCanvasDesc : template.description;
  const nodeCount = isBlank ? 0 : template.nodes.length;

  return (
    <button className={styles.card} onClick={() => onSelect(template)}>
      <TopologyPreview nodes={template?.nodes ?? []} />
      <span className={styles.name}>{name}</span>
      <span className={styles.desc}>{desc}</span>
      {!isBlank && <span className={styles.badge}>{nodeCount} {strings.templates.nodesBadge}</span>}
    </button>
  );
});
```

**`TopologyPreview`** — inline sub-component (~25 lines) inside `TemplateCard.tsx`. Renders template node positions as small dots (`<circle>`) with connecting lines (`<line>`) in a 100×60 SVG. Normalizes positions to fit the viewBox with `Math.min/max` scaling:

```typescript
function TopologyPreview({ nodes }: { nodes: readonly TemplateNode[] }) {
  if (nodes.length === 0) return <div className={styles.blankPreview} />;
  // Normalize positions to [0,1], then scale to 90×50 (5px margin each side)
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
  const scaleX = (x: number) => maxX === minX ? 45 : 5 + ((x - minX) / (maxX - minX)) * 90;
  const scaleY = (y: number) => maxY === minY ? 25 : 5 + ((y - minY) / (maxY - minY)) * 50;
  // SVG dots and lines…
}
```

**Creation flow** in `WorkspacePoolButton` (or a new `useTemplateCreation` hook):

```
1. User clicks "New Workspace"
2. TemplatePicker opens (pickerVisible=true, no workspace created yet)
3. User selects a template (or null for blank)
4. onSelect called →
   a. Close picker
   b. Create workspace via workspaceService → get workspaceId
   c. If template !== null: instantiateTemplate(template, workspaceId) → save nodes/edges
   d. Switch to new workspace (useWorkspaceStore.getState().setCurrentWorkspaceId)
   e. trackTemplateUsed(template.id, template.isCustom)
```

**`analyticsService.ts`** edit — add `trackTemplateUsed`:
```typescript
export function trackTemplateUsed(templateId: string, isCustom: boolean): void {
  track('template_used', { template_id: templateId, is_custom: isCustom });
}
```

### TDD Tests (10)

```
1.  Renders all 5 built-in templates + "Blank Canvas" card
2.  Each card shows name and description
3.  Clicking a template card calls onSelect with that template
4.  Clicking "Blank Canvas" card calls onSelect(null)
5.  Modal closes on Escape (useEscapeLayer MODAL=80)
6.  Modal closes on backdrop click
7.  Clicking inside modal does NOT close it (stopPropagation)
8.  Custom templates appear alongside built-ins when provided
9.  role="dialog" and aria-modal="true" present
10. TopologyPreview renders dots for each node (SVG circles)
```

### Tech Debt Checkpoint

- [ ] `TemplatePicker.tsx` under 90 lines
- [ ] `TemplateCard.tsx` under 50 lines (including `TopologyPreview`)
- [ ] `useEscapeLayer(ESCAPE_PRIORITY.MODAL, …)` in TemplatePicker
- [ ] Creation flow is async-safe: workspace created before instantiation
- [ ] `trackTemplateUsed` is a typed function (not added to `SettingKey`)
- [ ] CSS uses only `--color-*`, `--space-*`, `--radius-*` variables
- [ ] Zero lint errors

---

## Sub-phase 9D: Save as Template

### What We Build

Let users save their current workspace as a custom template for reuse. Includes Zod-validated read, input sanitisation, and delete capability.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/templates/services/customTemplateService.ts` | NEW | ~60 |
| `src/features/templates/services/__tests__/customTemplateService.test.ts` | NEW | ~65 |
| `src/features/workspace/components/WorkspacePoolButton.tsx` | EDIT | Add "Save as Template" menu item |

### Implementation

**`customTemplateService.ts`** (~60 lines):

```typescript
import { z } from 'zod';
import { customTemplatesSchema } from './templateSchemas';
import { tagNameSchema } from '@/shared/validation/schemas'; // existing Zod schema for names

export function saveAsTemplate(
  name: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): WorkspaceTemplate {
  // Validate name using existing schema (1-50 chars, no XSS)
  const parsedName = tagNameSchema.parse(name.trim());

  const existing = getCustomTemplates();
  if (existing.length >= MAX_CUSTOM_TEMPLATES) {
    throw new Error(templateStrings.errors.maxTemplatesReached);
  }
  if (nodes.length === 0) {
    throw new Error(templateStrings.errors.emptyCanvas);
  }

  // Normalize positions so top-left corner is (0,0)
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));

  const template: WorkspaceTemplate = {
    id:          `custom-${crypto.randomUUID()}`,
    name:         parsedName,
    description: templateStrings.customDescription,
    category:    'custom',
    isCustom:     true,
    nodes: nodes.map((n) => ({
      templateId: n.id,
      heading:    n.data?.heading ?? '',
      output:     n.data?.output  ?? '',
      position:   { x: n.position.x - minX, y: n.position.y - minY },
      colorKey:   n.data?.colorKey ?? 'default',
    })),
    edges: edges.map((e) => ({
      sourceTemplateId: e.source,
      targetTemplateId: e.target,
    })),
  };

  localStorage.setItem(
    CUSTOM_TEMPLATES_STORAGE_KEY,
    JSON.stringify([...existing, template])
  );
  return template;
}

export function getCustomTemplates(): WorkspaceTemplate[] {
  const raw = localStorage.getItem(CUSTOM_TEMPLATES_STORAGE_KEY);
  if (!raw) return [];
  try {
    // Zod validation prevents XSS / prototype pollution from malicious localStorage
    return customTemplatesSchema.parse(JSON.parse(raw));
  } catch {
    return []; // corrupt or tampered data — fail safe
  }
}

export function deleteCustomTemplate(templateId: string): void {
  const updated = getCustomTemplates().filter((t) => t.id !== templateId);
  localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(updated));
}
```

### TDD Tests (11)

```
1.  saveAsTemplate stores to localStorage
2.  Positions normalized to (0,0) top-left origin
3.  Throws when MAX_CUSTOM_TEMPLATES (10) is exceeded
4.  Throws when canvas is empty (no nodes)
5.  Throws when name fails tagNameSchema validation (empty, too long, XSS)
6.  getCustomTemplates returns [] for absent key
7.  getCustomTemplates returns [] (not throw) for corrupted JSON
8.  getCustomTemplates returns [] for JSON that fails Zod schema
9.  deleteCustomTemplate removes the correct template by ID
10. Template ID uses crypto.randomUUID() prefix
11. Custom template has isCustom=true
```

### Tech Debt Checkpoint

- [ ] `customTemplateService.ts` under 65 lines
- [ ] `getCustomTemplates()` validates via `customTemplatesSchema.parse()` (no raw cast)
- [ ] `saveAsTemplate()` validates `name` via existing `tagNameSchema`
- [ ] Graceful failure for corrupt/tampered localStorage data (returns `[]`, never throws)
- [ ] `crypto.randomUUID()` for template ID
- [ ] Zero lint errors

---

## Phase 9 Summary

### Execution Order

| Sub-phase | What | Why This Order |
|-----------|------|----------------|
| 9A | Types + Zod schemas + definitions + strings | Foundation — typed contracts before any logic |
| 9B | Instantiation service | Pure function, fully tested in isolation |
| 9C | Template picker modal + analytics + creation flow | Consumes 9A + 9B; wires into workspace creation |
| 9D | Save as template | Adds write path to the same localStorage store |

### Net Impact

- **Files created**: ~19 (types, schemas, services, components, CSS, strings, tests)
- **Files edited**: 3 (WorkspacePoolButton, analyticsService, strings.ts)
- **Net line count change**: ~+800 lines across new files; +~30 lines across edits
- **User impact**: New workspaces start with structure, not emptiness. Custom templates enable personal workflow reuse.
- **New user impact**: "BASB CODE Flow" template immediately teaches Capture → Organize → Distill → Express.

### Built-in Template Details

| Template | Nodes | Edges | Color | Teaching Goal |
|----------|-------|-------|-------|---------------|
| BASB CODE Flow | 4 | 3 (linear chain) | success | Core BASB methodology |
| Project Kickoff | 5 | 4 (hub-and-spoke) | warning centre | Structured planning |
| Research Canvas | 6 | 5 (tree) | default | Deep inquiry structure |
| Brainstorm | 8 | 0 (no connections) | default | Divergent thinking (connect later) |
| Weekly Review | 4 | 3 (linear chain) | default | Periodic reflection habit |

### Security Model

| Threat | Mitigation |
|--------|-----------|
| XSS via malicious localStorage | Zod schema rejects unknown fields, enforces string length limits |
| Prototype pollution | Zod schema parses into plain objects, never merges with prototype |
| Unbounded storage growth | Hard cap: `MAX_CUSTOM_TEMPLATES = 10`; each template has node/edge count limits in schema |
| Name injection | `tagNameSchema` (existing Zod schema) validates length and character set |

### What's NOT Included

| Item | Reason |
|------|--------|
| Server-synced templates | Over-engineering — localStorage sufficient for personal use |
| Template marketplace / sharing | Future feature if demand exists |
| Template versioning | Not needed for static definitions |
| AI-generated templates | Adds AI dependency to a static feature |
| Template categories filter UI | 5+custom templates doesn't warrant a filter |

### Zustand & ReactFlow Safety

- **No new Zustand store** — template picker uses local `useState`; creation flow uses `getState()` for one-shot actions
- **Single workspace-store write** in creation flow: `useWorkspaceStore.getState().setCurrentWorkspaceId(id)` — no cascade
- **`instantiateTemplate` is a pure function** — no store access, no ReactFlow interaction
- **No new useEffect chains** touching canvas store — zero ReactFlow cascade risk
