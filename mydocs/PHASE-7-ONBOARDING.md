# Phase 7: Onboarding & First-Run Experience — Zero Learning Curve

> **Status: Historical feature plan or audit. May not match the code; the code and `docs/launch/LAUNCH-CHECKLIST.md` win.**

## Problem Statement

A new user opens ActionStation and sees an empty canvas with a top bar, a sidebar, and no guidance. They don't know that headings are AI prompts, that connecting nodes creates context chains, that selecting multiple nodes enables synthesis, or that right-click opens a context menu. The app has powerful features — but a blank canvas with zero onboarding means users must discover everything by accident. This is the #1 reason people bounce from productivity tools: the first 60 seconds don't show value.

## Intended Solution

A **two-stage first-run experience** that fires once on a user's very first login:

1. **WelcomeScreen** — a single full-screen moment (not a modal wall) that introduces the app, confirms early-access context, and previews the three core capabilities with a "Let's go →" CTA.
2. **3-step coach mark walkthrough** — appears immediately after dismissing the welcome, pointing at real UI elements with "Try:" action prompts that direct the user to perform the action rather than just read about it.

After the walkthrough, a persistent "?" help button links to a keyboard shortcuts panel and a "Replay walkthrough" option.

**What this is NOT**: no video tutorials, no 7-slide modal walls, no 10-step wizards, no account-setup forms inside onboarding. The canvas loads in the background — the welcome screen is one screen, then the user is on the live canvas immediately.

## Architecture Decisions

- **New feature module**: `src/features/onboarding/` (types, hooks, components, strings)
- **No new Zustand store** — all state managed by a single `useReducer` with lazy `localStorage` init
- **`useReducer` state machine with pre-step**: `OnboardingState` has three fields — `showWelcome`, `stepIndex`, `isCompleted`. All transitions are pure, isolated from canvas store. Zero ReactFlow cascade risk.
- **Two localStorage keys**: `welcome_shown` (write-once, never cleared) + `onboarding_completed` (cleared on replay)
- **Gating model**: `DISMISS_WELCOME` action transitions directly to `stepIndex: 0`. `START` is a no-op when `showWelcome: true` — the welcome screen gates the coach marks.
- **"Try:" action prompts**: Every coach mark has an optional `tryPrompt` string rendered as a distinct styled line (e.g. `"Try: Click + and type your first thought"`). This is a prop on `CoachMark`, not logic.
- **WelcomeScreen design**: Full-screen opaque overlay (`var(--color-background)`), portal-rendered. Shows app identity + 3 capability bullets + single CTA. Escape or "Let's go →" both dismiss it.
- **Coach marks, not modals** — positioned relative to target elements via `getBoundingClientRect()`, portal-rendered into `document.body`
- **Backdrop**: `clip-path` polygon via inline style; `pointer-events: none` so the spotlit target stays interactive
- **Workspace-load trigger**: `useEffect` on `currentWorkspaceId` selector fires `start()` when workspace is ready — no `setTimeout`
- **Non-blocking**: User can skip at any step (click "Skip tour" or press Escape) — `useEscapeLayer(ESCAPE_PRIORITY.MODAL, …)`
- **Replay**: dispatches `{ type: 'REPLAY' }` — skips welcome, goes straight to step 1
- **CSS variables**: All CSS uses `--color-*` family exclusively — `--surface-primary` does **not** exist in this codebase
- **Strings**: `onboardingStrings.ts` lives in the feature folder; imported into `strings.ts` as `strings.onboarding` (strings.ts at 291 lines; +4 lines = 295, safely under 300)
- **HelpButton z-index**: `var(--z-sticky)` (200) — above canvas, below modals/settings; returns `null` while welcome or coach marks are active

---

## Sub-phase 7A: Onboarding Types, Reducer, Hook & WelcomeScreen

### What We Build

The full state machine (including welcome pre-step), the `useOnboarding` hook, the `WelcomeScreen` component, and all string resources. No canvas interaction yet — everything is testable in isolation.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/onboarding/types/onboarding.ts` | NEW | ~45 |
| `src/features/onboarding/hooks/useOnboarding.ts` | NEW | ~75 |
| `src/features/onboarding/hooks/__tests__/useOnboarding.test.ts` | NEW | ~100 |
| `src/features/onboarding/strings/onboardingStrings.ts` | NEW | ~55 |
| `src/features/onboarding/components/WelcomeScreen.tsx` | NEW | ~60 |
| `src/features/onboarding/components/WelcomeScreen.module.css` | NEW | ~40 |
| `src/features/onboarding/components/__tests__/WelcomeScreen.test.tsx` | NEW | ~55 |

### Implementation

**`onboarding.ts`** (~45 lines):

```typescript
export const ONBOARDING_STEPS = ['createNode', 'connectNodes', 'synthesize'] as const;
export type OnboardingStep = typeof ONBOARDING_STEPS[number];
export type OnboardingPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface CoachMarkConfig {
  readonly step: OnboardingStep;
  readonly targetSelector: string;
  readonly placement: OnboardingPlacement;
  readonly tryPrompt?: string; // optional action hint: "Try: Click + and type…"
}

export const STORAGE_KEY         = 'onboarding_completed';
export const WELCOME_STORAGE_KEY = 'welcome_shown';       // write-once, never cleared on replay

export interface OnboardingState {
  readonly showWelcome: boolean;      // true = render WelcomeScreen (gates coach marks)
  readonly stepIndex:   number | null; // null = no active coach mark
  readonly isCompleted: boolean;
}

export type OnboardingAction =
  | { readonly type: 'START' }           // fires when workspace loads
  | { readonly type: 'DISMISS_WELCOME' } // "Let's go →" clicked
  | { readonly type: 'NEXT' }
  | { readonly type: 'SKIP' }
  | { readonly type: 'REPLAY' };         // skips welcome, starts from step 1
```

**`useOnboarding.ts`** (~75 lines):

```typescript
import { useReducer, useEffect, useCallback } from 'react';
import { ONBOARDING_STEPS, STORAGE_KEY, WELCOME_STORAGE_KEY,
         OnboardingState, OnboardingAction } from '../types/onboarding';

export function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction
): OnboardingState {
  switch (action.type) {
    case 'START':
      // Welcome is still visible — it gates coach marks; wait for DISMISS_WELCOME
      if (state.isCompleted || state.showWelcome) return state;
      return { ...state, stepIndex: 0 };

    case 'DISMISS_WELCOME':
      if (!state.showWelcome) return state;
      // Hide welcome + start step 1 (unless already completed)
      return { showWelcome: false, stepIndex: state.isCompleted ? null : 0,
               isCompleted: state.isCompleted };

    case 'NEXT': {
      if (state.stepIndex === null) return state;
      const isLast = state.stepIndex >= ONBOARDING_STEPS.length - 1;
      return isLast
        ? { ...state, stepIndex: null, isCompleted: true }
        : { ...state, stepIndex: state.stepIndex + 1 };
    }

    case 'SKIP':
      return { ...state, stepIndex: null, isCompleted: true };

    case 'REPLAY':
      // Skip welcome (already seen); go straight to step 1
      return { showWelcome: false, stepIndex: 0, isCompleted: false };

    default:
      return state;
  }
}

export function useOnboarding() {
  const [state, dispatch] = useReducer(
    onboardingReducer,
    undefined,
    (): OnboardingState => ({
      showWelcome:  localStorage.getItem(WELCOME_STORAGE_KEY) !== 'true',
      stepIndex:    null,
      isCompleted:  localStorage.getItem(STORAGE_KEY) === 'true',
    })
  );

  // Sync showWelcome=false → localStorage (write-once key)
  useEffect(() => {
    if (!state.showWelcome) localStorage.setItem(WELCOME_STORAGE_KEY, 'true');
  }, [state.showWelcome]);

  // Sync isCompleted → localStorage (cleared on replay)
  useEffect(() => {
    if (state.isCompleted) localStorage.setItem(STORAGE_KEY, 'true');
    else localStorage.removeItem(STORAGE_KEY);
  }, [state.isCompleted]);

  const start          = useCallback(() => dispatch({ type: 'START' }),           []);
  const dismissWelcome = useCallback(() => dispatch({ type: 'DISMISS_WELCOME' }), []);
  const next           = useCallback(() => dispatch({ type: 'NEXT' }),            []);
  const skip           = useCallback(() => dispatch({ type: 'SKIP' }),            []);
  const replay         = useCallback(() => dispatch({ type: 'REPLAY' }),          []);

  return {
    showWelcome:  state.showWelcome,
    activeStep:   state.stepIndex !== null ? ONBOARDING_STEPS[state.stepIndex] : null,
    stepIndex:    state.stepIndex,
    totalSteps:   ONBOARDING_STEPS.length,
    isCompleted:  state.isCompleted,
    start, dismissWelcome, next, skip, replay,
  };
}
```

**`WelcomeScreen.tsx`** (~60 lines):

```typescript
interface WelcomeScreenProps {
  readonly onDismiss: () => void; // "Let's go →" or Escape
}

export const WelcomeScreen = React.memo(function WelcomeScreen({ onDismiss }: WelcomeScreenProps) {
  // MODAL priority — nothing should be above the welcome screen on first visit
  useEscapeLayer(ESCAPE_PRIORITY.MODAL, true, onDismiss);

  return createPortal(
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.logoRow}>
          {/* App icon — replace with actual <img> or SVG component */}
          <span className={styles.logoPlaceholder} aria-hidden="true" />
          <span className={styles.appName}>{strings.app.name}</span>
        </div>

        <span className={styles.badge}>{strings.onboarding.welcome.earlyAccess}</span>

        <h1 className={styles.title}>{strings.onboarding.welcome.title}</h1>

        <p className={styles.intro}>{strings.onboarding.welcome.intro}</p>

        <ul className={styles.bullets}>
          <li>{strings.onboarding.welcome.bullet1}</li>
          <li>{strings.onboarding.welcome.bullet2}</li>
          <li>{strings.onboarding.welcome.bullet3}</li>
        </ul>

        <button className={styles.cta} onClick={onDismiss} autoFocus>
          {strings.onboarding.welcome.ctaLabel}  {/* "Let's go →" */}
        </button>
      </div>
    </div>,
    document.body
  );
});
```

**`WelcomeScreen.module.css`** (~40 lines):

```css
.overlay {
  position: fixed;
  inset: 0;
  background: var(--color-background); /* opaque — canvas visible behind on mount */
  z-index: calc(var(--z-modal) + 10);
  display: flex;
  align-items: center;
  justify-content: center;
}
.card {
  max-width: 560px;
  padding: var(--space-2xl);
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.logoRow  { display: flex; align-items: center; gap: var(--space-sm); }
.appName  { color: var(--color-text-primary); font-size: var(--font-size-lg);
            font-weight: var(--font-weight-bold); }
.badge    { display: inline-block; color: var(--color-primary);
            border: 1px solid var(--color-primary); border-radius: var(--radius-full);
            padding: var(--space-xxs) var(--space-sm); font-size: var(--font-size-xs); }
.title    { color: var(--color-text-primary); font-size: var(--font-size-2xl);
            font-weight: var(--font-weight-bold); }
.intro    { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
.bullets  { color: var(--color-text-secondary); font-size: var(--font-size-sm);
            line-height: var(--line-height-relaxed); list-style: disc; padding-left: var(--space-lg); }
.cta      { align-self: flex-start; background: var(--color-primary);
            color: var(--color-text-on-primary); border: none;
            border-radius: var(--radius-md); padding: var(--space-sm) var(--space-xl);
            font-size: var(--font-size-md); font-weight: var(--font-weight-medium);
            cursor: pointer; margin-top: var(--space-sm); }
.cta:hover { background: var(--color-primary-hover); }
```

**`onboardingStrings.ts`** (~55 lines): All copy. Bullet copy previews the 3 coach mark lessons so the welcome and walkthrough feel like one coherent arc.

```typescript
export const onboardingStrings = {
  welcome: {
    earlyAccess: 'Early access',
    title:       'Welcome to ActionStation',
    intro:       'A few things to know before you start:',
    bullet1:     'Each card title is your AI prompt — type a thought, generate a response',
    bullet2:     'Connect cards to build context chains for richer AI output',
    bullet3:     'Select multiple cards and Synthesize to reason across your whole canvas',
    ctaLabel:    "Let's go →",
  },
  step1: {
    title:       'Create a thought',
    description: 'Each card title becomes your AI prompt.',
    tryPrompt:   'Try: Click + and type your first thought',
  },
  step2: {
    title:       'Connect your ideas',
    description: 'Connected cards build context chains for richer AI output.',
    tryPrompt:   'Try: Hover a card edge to reveal ●, then drag to another card',
  },
  step3: {
    title:       'Synthesize your thinking',
    description: 'AI respects your canvas structure when generating.',
    tryPrompt:   'Try: Select two connected cards, then click Synthesize',
  },
  stepLabel:           (i: number, total: number) => `Step ${i} of ${total}`,
  nextLabel:           'Next',
  doneLabel:           'Done',
  skipLabel:           'Skip tour',
  replayWalkthrough:   'Replay walkthrough',
  helpButtonLabel:     'Help and keyboard shortcuts',
  helpButtonIcon:      '?',
  shortcutsPanelTitle: 'Keyboard shortcuts',
  shortcuts: { /* groups: Navigation, Nodes, Selection, Canvas */ },
};
```

### TDD Tests (15)

```
Reducer tests (no React):
1.  START → stepIndex=0 when showWelcome=false, isCompleted=false
2.  START → no-op when showWelcome=true (welcome gates coach marks)
3.  START → no-op when isCompleted=true
4.  DISMISS_WELCOME → showWelcome=false, stepIndex=0 when not completed
5.  DISMISS_WELCOME → showWelcome=false, stepIndex=null when already completed
6.  DISMISS_WELCOME → no-op when showWelcome already false
7.  NEXT → increments stepIndex
8.  NEXT on last step → isCompleted=true, stepIndex=null
9.  SKIP → isCompleted=true, stepIndex=null
10. REPLAY → showWelcome=false, stepIndex=0, isCompleted=false

Hook tests (with React Testing Library):
11. Lazy init: showWelcome=true when welcome_shown absent from localStorage
12. Lazy init: showWelcome=false when welcome_shown='true' in localStorage
13. useEffect: welcome_shown written to localStorage when showWelcome→false
14. useEffect: onboarding_completed written when isCompleted→true
15. useEffect: onboarding_completed removed when isCompleted→false (after REPLAY)
```

**WelcomeScreen TDD Tests (6)**

```
1.  Renders title and all 3 bullets from strings
2.  "Let's go →" button calls onDismiss
3.  Escape key calls onDismiss (useEscapeLayer MODAL=80)
4.  Renders in portal (document.body)
5.  CTA button receives autoFocus on mount
6.  No inline strings — all text from string resources
```

### Tech Debt Checkpoint

- [ ] `onboarding.ts` under 50 lines
- [ ] `useOnboarding.ts` under 80 lines
- [ ] Pure reducer exported separately — testable without React
- [ ] Both `useEffect` syncs are separate (one per localStorage key)
- [ ] `WelcomeScreen.tsx` under 65 lines
- [ ] All copy in `onboardingStrings.ts` — zero inline strings
- [ ] Zero lint errors

---

## Sub-phase 7B: Coach Mark Component

### What We Build

A reusable `CoachMark` component that spotlights a target element and shows instructional text with an optional "Try:" action prompt. Portal-rendered; escape-layer wired.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/onboarding/components/CoachMark.tsx` | NEW | ~95 |
| `src/features/onboarding/components/CoachMark.module.css` | NEW | ~70 |
| `src/features/onboarding/components/__tests__/CoachMark.test.tsx` | NEW | ~95 |

### Implementation

**`CoachMark.tsx`** (~95 lines):

```typescript
interface CoachMarkProps {
  readonly targetSelector: string;
  readonly title:       string;
  readonly description: string;
  readonly tryPrompt?:  string;   // "Try: Click + and type your first thought"
  readonly placement:   OnboardingPlacement;
  readonly stepLabel:   string;   // "Step 1 of 3"
  readonly onNext:      () => void;
  readonly onSkip:      () => void;
  readonly nextLabel:   string;   // "Next" or "Done"
  readonly skipLabel:   string;   // "Skip tour"
  readonly isLastStep:  boolean;
}

export const CoachMark = React.memo(function CoachMark(props: CoachMarkProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const markRef = useRef<HTMLDivElement>(null);

  useEscapeLayer(ESCAPE_PRIORITY.MODAL, true, props.onSkip);

  useEffect(() => {
    const target = document.querySelector(props.targetSelector);
    if (!target) return;
    const update = () => setRect(target.getBoundingClientRect());
    update();
    const ro = new ResizeObserver(update);
    ro.observe(target);
    window.addEventListener('resize', update, { passive: true });
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, [props.targetSelector]);

  useEffect(() => { markRef.current?.focus(); }, []);

  if (!rect) return null;

  const PAD = 6;
  const { left: l, top: t, right: r, bottom: b } = rect;
  const clipPath =
    `polygon(0% 0%,0% 100%,${l - PAD}px 100%,${l - PAD}px ${t - PAD}px,` +
    `${r + PAD}px ${t - PAD}px,${r + PAD}px ${b + PAD}px,` +
    `${l - PAD}px ${b + PAD}px,${l - PAD}px 100%,100% 100%,100% 0%)`;

  return createPortal(
    <>
      <div className={styles.backdrop} style={{ clipPath }} aria-hidden="true" />
      <div
        ref={markRef}
        className={`${styles.coachMark} ${styles[props.placement]}`}
        style={computePosition(rect, props.placement, PAD)}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
      >
        <span className={styles.step}>{props.stepLabel}</span>
        <h3 className={styles.title}>{props.title}</h3>
        <p className={styles.description}>{props.description}</p>
        {props.tryPrompt && (
          <p className={styles.tryPrompt}>{props.tryPrompt}</p>
        )}
        <div className={styles.actions}>
          <button className={styles.skipBtn} onClick={props.onSkip}>{props.skipLabel}</button>
          <button className={styles.nextBtn} onClick={props.onNext}>{props.nextLabel}</button>
        </div>
      </div>
    </>,
    document.body
  );
});

function computePosition(rect: DOMRect, placement: OnboardingPlacement, pad: number): React.CSSProperties {
  const gap = pad + 12;
  switch (placement) {
    case 'right':  return { position: 'fixed', left: rect.right + gap,  top: rect.top };
    case 'left':   return { position: 'fixed', right: window.innerWidth - rect.left + gap, top: rect.top };
    case 'bottom': return { position: 'fixed', left: rect.left, top: rect.bottom + gap };
    case 'top':    return { position: 'fixed', left: rect.left, bottom: window.innerHeight - rect.top + gap };
  }
}
```

**CSS — all `--color-*` variables** (`CoachMark.module.css`, ~70 lines):

```css
.backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: var(--z-modal);
  pointer-events: none; /* clicks pass through the spotlight hole to the target */
}
.coachMark {
  position: fixed;
  z-index: calc(var(--z-modal) + 1);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  max-width: 280px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  pointer-events: auto;
}
.step        { color: var(--color-text-muted);   font-size: var(--font-size-xs); }
.title       { color: var(--color-text-primary); font-size: var(--font-size-md);
               font-weight: var(--font-weight-semibold); margin: var(--space-xs) 0; }
.description { color: var(--color-text-secondary); font-size: var(--font-size-sm);
               line-height: var(--line-height-normal); }

/* "Try:" prompt — visually distinct from description */
.tryPrompt {
  margin-top: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  background: var(--color-primary-light);
  border-radius: var(--radius-sm);
  color: var(--color-primary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.actions  { display: flex; justify-content: space-between; gap: var(--space-sm);
            margin-top: var(--space-md); }
.skipBtn  { background: transparent; color: var(--color-text-muted); border: none;
            font-size: var(--font-size-sm); cursor: pointer; }
.nextBtn  { background: var(--color-primary); color: var(--color-text-on-primary);
            border: none; border-radius: var(--radius-md);
            padding: var(--space-xs) var(--space-md);
            font-weight: var(--font-weight-medium); cursor: pointer; }
.nextBtn:hover { background: var(--color-primary-hover); }

/* Arrow per placement */
.right::before  { /* arrow pointing left  */ }
.left::before   { /* arrow pointing right */ }
.bottom::before { /* arrow pointing up    */ }
.top::before    { /* arrow pointing down  */ }
```

### TDD Tests (12)

```
1.  Renders title and description from props
2.  Renders tryPrompt in a distinct element when provided
3.  Does NOT render tryPrompt element when prop is absent
4.  Shows step label ("Step 1 of 3")
5.  "Next" button calls onNext
6.  "Skip tour" button calls onSkip
7.  Renders in portal (document.body)
8.  role="dialog" and aria-modal="true" present
9.  Returns null when target element not found (rect=null)
10. backdrop clip-path string contains target coordinates
11. Escape key → onSkip (via useEscapeLayer MODAL=80)
12. ResizeObserver disconnected on unmount (no leak)
```

### Tech Debt Checkpoint

- [ ] `CoachMark.tsx` under 100 lines
- [ ] `tryPrompt` is an optional prop — no logic, just conditional render
- [ ] No hardcoded colours — all `--color-*` CSS variables
- [ ] `pointer-events: none` on backdrop (spotlight target stays interactive)
- [ ] ResizeObserver + window resize listener cleaned up in effect return
- [ ] `aria-modal="true"` present
- [ ] `useEscapeLayer(ESCAPE_PRIORITY.MODAL, …)` wired
- [ ] Zero lint errors

---

## Sub-phase 7C: Walkthrough Orchestrator & Integration

### What We Build

Wire the full two-stage experience into the app. `OnboardingWalkthrough` renders either `WelcomeScreen` or `CoachMark` depending on reducer state. Adds `data-testid` attributes to the 3 target elements.

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/onboarding/components/OnboardingWalkthrough.tsx` | NEW | ~75 |
| `src/features/onboarding/components/__tests__/OnboardingWalkthrough.test.tsx` | NEW | ~85 |
| `src/features/onboarding/index.ts` | NEW | ~5 |
| `src/app/App.tsx` | EDIT | Mount `<OnboardingWalkthrough />` inside `AuthenticatedApp` |
| `src/features/workspace/components/WorkspaceControls.tsx` | EDIT | Add `data-testid="add-node-button"` to the + button |
| `src/features/canvas/components/CanvasView.tsx` | EDIT | Add `data-testid="canvas-area"` to the ReactFlow container div |
| `src/features/synthesis/components/SelectionToolbar.tsx` | EDIT | Add `data-testid="selection-toolbar"` to the toolbar root |
| `src/app/components/SettingsPanel/sections/AboutSection.tsx` | EDIT | Add "Replay walkthrough" button |
| `src/shared/localization/strings.ts` | EDIT | Import `onboardingStrings`; add `onboarding:` key (~+4 lines, safe at 295) |

### Implementation

**Step configs with "Try:" prompts** (in `OnboardingWalkthrough.tsx`):

```typescript
const COACH_MARKS: CoachMarkConfig[] = [
  {
    step:           'createNode',
    targetSelector: '[data-testid="add-node-button"]',  // added in this phase
    placement:      'right',
    tryPrompt:      strings.onboarding.step1.tryPrompt, // "Try: Click + and type your first thought"
  },
  {
    step:           'connectNodes',
    // No "connect-button" exists — connections are made by dragging node handles.
    // The coach mark targets the canvas itself and explains the handle-drag gesture.
    targetSelector: '[data-testid="canvas-area"]',      // added in this phase
    placement:      'bottom',
    tryPrompt:      strings.onboarding.step2.tryPrompt, // "Try: Hover a card edge to reveal ●, then drag to another card"
  },
  {
    step:           'synthesize',
    targetSelector: '[data-testid="selection-toolbar"]', // added in this phase
    placement:      'bottom',
    tryPrompt:      strings.onboarding.step3.tryPrompt, // "Try: Select two connected cards, then click Synthesize"
  },
];
```

**`OnboardingWalkthrough.tsx`** — render priority + workspace-load trigger:

```typescript
export function OnboardingWalkthrough() {
  const { showWelcome, activeStep, stepIndex, totalSteps, isCompleted,
          start, dismissWelcome, next, skip, replay } = useOnboarding();

  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId); // selector only
  const startedRef  = useRef(false); // survives StrictMode double-invoke

  useEffect(() => {
    if (workspaceId && !startedRef.current) {
      startedRef.current = true;
      start(); // no-op if showWelcome=true (welcome gates) or isCompleted=true
    }
  }, [workspaceId, start]);

  // Stage 1: WelcomeScreen gates everything
  if (showWelcome) {
    return <WelcomeScreen onDismiss={dismissWelcome} />;
  }

  // Stage 2: coach marks
  if (activeStep === null) return null;
  const config    = COACH_MARKS.find((c) => c.step === activeStep)!;
  const stepLabel = strings.onboarding.stepLabel(stepIndex! + 1, totalSteps);
  const isLast    = stepIndex === totalSteps - 1;

  return (
    <CoachMark
      targetSelector={config.targetSelector}
      title={strings.onboarding[activeStep].title}
      description={strings.onboarding[activeStep].description}
      tryPrompt={config.tryPrompt}
      placement={config.placement}
      stepLabel={stepLabel}
      onNext={isLast ? skip : next}  // last step: "Done" also marks complete
      onSkip={skip}
      nextLabel={isLast ? strings.onboarding.doneLabel : strings.onboarding.nextLabel}
      skipLabel={strings.onboarding.skipLabel}
      isLastStep={isLast}
    />
  );
}
```

**"Replay walkthrough"** in `AboutSection.tsx` calls `replay()` which skips the welcome and starts from step 1.

### TDD Tests (11)

```
1.  WelcomeScreen renders on first visit (welcome_shown absent)
2.  WelcomeScreen does NOT render when welcome_shown='true'
3.  Coach marks do NOT render while WelcomeScreen is visible
4.  Dismissing WelcomeScreen → step 1 coach mark appears
5.  Step 1 coach mark targets [data-testid="add-node-button"]
6.  Step 1 coach mark shows tryPrompt from strings
7.  Clicking Next advances from step 1 → step 2 → step 3
8.  Clicking Skip → no coach marks, completed flag set
9.  After step 3 Done → completed flag set in localStorage
10. Replay → skips WelcomeScreen, starts at step 1
11. startedRef guard prevents double-fire in StrictMode
```

### Tech Debt Checkpoint

- [ ] `OnboardingWalkthrough.tsx` under 80 lines
- [ ] No `setTimeout` — workspace-load trigger via Zustand selector only
- [ ] `data-testid` added to all 3 target elements in their respective source files
- [ ] `strings.ts` remains under 300 lines (291 + 4 = 295)
- [ ] `COACH_MARKS` array uses `strings.onboarding.*` for all copy — zero inline strings
- [ ] Zero lint errors

---

## Sub-phase 7D: Help Button & Keyboard Cheat Sheet

### What We Build

A persistent "?" button (fixed, bottom-right) that opens a keyboard shortcuts panel and a "Replay walkthrough" link. Hidden while the welcome screen or coach marks are active. ShortcutsPanel uses escape layer at `SETTINGS_PANEL` priority (70).

### Files

| File | Action | Lines (est.) |
|------|--------|-------------|
| `src/features/onboarding/components/HelpButton.tsx` | NEW | ~45 |
| `src/features/onboarding/components/HelpButton.module.css` | NEW | ~30 |
| `src/features/onboarding/components/ShortcutsPanel.tsx` | NEW | ~65 |
| `src/features/onboarding/components/ShortcutsPanel.module.css` | NEW | ~45 |
| `src/features/onboarding/components/__tests__/HelpButton.test.tsx` | NEW | ~45 |

### Implementation

**`HelpButton.tsx`** (~45 lines):

```typescript
interface HelpButtonProps {
  readonly isOnboardingActive: boolean; // true while WelcomeScreen OR coach marks are showing
  readonly onReplay: () => void;
}

export const HelpButton = React.memo(function HelpButton(
  { isOnboardingActive, onReplay }: HelpButtonProps
) {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  const close  = useCallback(() => setIsOpen(false),     []);

  // Don't stack two MODAL-priority escape handlers
  if (isOnboardingActive) return null;

  return (
    <>
      <button className={styles.helpButton} onClick={toggle}
              aria-label={strings.onboarding.helpButtonLabel}>
        {strings.onboarding.helpButtonIcon}
      </button>
      {isOpen && <ShortcutsPanel onClose={close} onReplay={onReplay} />}
    </>
  );
});
```

**CSS** — `HelpButton.module.css` (~30 lines):

```css
.helpButton {
  position: fixed; bottom: var(--space-lg); right: var(--space-lg);
  z-index: var(--z-sticky); /* 200 — above canvas, below modals/settings */
  width: 36px; height: 36px;
  border-radius: var(--radius-full);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}
.helpButton:hover { background: var(--color-surface-hover); }
```

**`ShortcutsPanel.tsx`** (~65 lines): Portal-rendered panel listing shortcut groups (Navigation, Nodes, Selection, Canvas) from `strings.onboarding.shortcuts.*`. `useEscapeLayer(ESCAPE_PRIORITY.SETTINGS_PANEL, true, onClose)`. Includes a "Replay walkthrough" button.

### TDD Tests (7)

```
1.  HelpButton renders "?" with aria-label from strings
2.  HelpButton returns null when isOnboardingActive=true
3.  Clicking HelpButton opens ShortcutsPanel
4.  ShortcutsPanel lists all shortcut groups
5.  "Replay walkthrough" link calls onReplay
6.  Escape closes ShortcutsPanel (useEscapeLayer SETTINGS_PANEL=70)
7.  All labels from string resources — no inline strings
```

### Tech Debt Checkpoint

- [ ] `HelpButton.tsx` under 50 lines
- [ ] `ShortcutsPanel.tsx` under 70 lines
- [ ] `HelpButton` returns `null` when `isOnboardingActive=true` (no stacked escape handlers)
- [ ] `useEscapeLayer(ESCAPE_PRIORITY.SETTINGS_PANEL, …)` in ShortcutsPanel
- [ ] CSS uses only `--color-*`, `--space-*`, `--font-*`, `--radius-*`, `--z-*` variables
- [ ] Portal rendering for ShortcutsPanel
- [ ] Zero lint errors

---

## Phase 7 Summary

### Execution Order

| Sub-phase | What | Why This Order |
|-----------|------|----------------|
| 7A | Types + reducer + hook + **WelcomeScreen** + strings | Full state machine + first visible UI, tested in isolation |
| 7B | CoachMark component with "Try:" prompt | Reusable, tested independently of orchestrator |
| 7C | OnboardingWalkthrough + `data-testid` additions | Composes both components with real step configs |
| 7D | HelpButton + ShortcutsPanel | Persistent access after walkthrough completes |

### Net Impact

- **Files created**: ~22 (types, hooks, components, CSS, strings, tests)
- **Files edited**: 7 (App.tsx, WorkspaceControls, CanvasView, SelectionToolbar, AboutSection, strings.ts)
- **Net line count change**: ~+870 lines across new files; +~20 lines across edits
- **User impact**: First visit goes from "blank canvas confusion" to a coherent two-stage welcome → walkthrough arc
- **Returning users**: "?" button provides ongoing shortcut discovery + walkthrough replay

### The Full First-Run Flow

**Stage 1 — WelcomeScreen** (fires on true first login only):

| Element | Content |
|---------|---------|
| Badge | "Early access" |
| Heading | "Welcome to ActionStation" |
| Bullet 1 | "Each card title is your AI prompt — type a thought, generate a response" |
| Bullet 2 | "Connect cards to build context chains for richer AI output" |
| Bullet 3 | "Select multiple cards and Synthesize to reason across your whole canvas" |
| CTA | "Let's go →" |

**Stage 2 — Coach Marks** (fires after welcome dismissal):

| Step | Target | Title | "Try:" Prompt |
|------|--------|-------|---------------|
| 1 of 3 | `[data-testid="add-node-button"]` | Create a thought | *Try: Click + and type your first thought* |
| 2 of 3 | `[data-testid="canvas-area"]` | Connect your ideas | *Try: Hover a card edge to reveal ●, then drag to another card* |
| 3 of 3 | `[data-testid="selection-toolbar"]` | Synthesize your thinking | *Try: Select two connected cards, then click Synthesize* |

### What's NOT Included

| Item | Reason |
|------|--------|
| 7-slide pre-canvas feature showcase | One welcome screen is sufficient; we're canvas-first |
| Workspace naming in onboarding | Handled by workspace creation flow (Phase 9) |
| Profile photo step | Not a blocker for first-run value; future personalisation feature |
| Team invite in onboarding | Single-user tool |
| Interactive sandbox | Real canvas IS the sandbox |
| Email onboarding drip | Server-side, out of scope |

### Zustand & ReactFlow Safety

- **No new Zustand store** — `useReducer` with lazy `localStorage` init; canvas store untouched
- **Single selector** in `OnboardingWalkthrough`: `useWorkspaceStore((s) => s.currentWorkspaceId)` — stable, no closure variables
- **Escape layer** uses existing `useEscapeLayer` hook — no custom event listeners
- **WelcomeScreen and CoachMark state** are fully isolated from canvas store — zero ReactFlow cascade risk
