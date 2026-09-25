---
name: free-tier-limits
description: Free/Pro tier limits, tier reducer/context, and guard entry points. Use when touching workspace/node/AI/storage caps or upgrade gating.
---

| Resource | Free | Pro |
|----------|------|-----|
| Workspaces | 5 | Unlimited |
| Nodes/workspace | 12 | Unlimited |
| AI generations/day | 60 | Unlimited |
| Storage/user | 50 MB | Unlimited |
| KB entries | No cap | No cap |

**Architecture**: Pure `useReducer` state machine in React Context, isolated from Zustand.
- **Constants**: `FREE_TIER_LIMITS` / `PRO_TIER_LIMITS` in `src/features/subscription/types/tierLimits.ts` (SSOT)
- **Reducer**: `src/features/subscription/stores/tierLimitsReducer.ts`
- **Context**: `src/features/subscription/contexts/TierLimitsContext.tsx` (wraps `AuthenticatedApp`)
- **Hook**: `src/features/subscription/hooks/useTierLimits.ts`

**Guard entry points** (user-initiated operations only):
- `useWorkspaceOperations.ts`: `check('workspace')` → Modal (UpgradeWall)
- `useAddNode.ts`: `useNodeCreationGuard` → Toast
- `useNodeGeneration.ts`: `check('aiDaily')` → Toast

**Firestore paths**:
- `users/{userId}/usage/aiDaily` — AI daily counter (server-writes only via `dailyAiLimiter.ts`)
- `users/{userId}/usage/storage` — cumulative bytes (client read+write)

**Server-authoritative**: `geminiProxy.ts` Cloud Function calls `checkAndIncrementDailyAi()` before forwarding to Gemini. Client check is optimistic UI only.
