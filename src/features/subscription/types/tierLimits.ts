/**
 * Tier Limits — Constants, state, and types for free/pro usage limits.
 * Pure data layer — no runtime dependencies, no side effects.
 */
import type { SubscriptionTier } from './subscription';

// ── Free Tier Constants ──────────────────────────────────────────────────────

export const FREE_TIER_LIMITS = {
    maxWorkspaces: 5,
    maxNodesPerWorkspace: 12,
    maxAiGenerationsPerDay: 60,
    maxStorageMb: 50,
} as const;

export const PRO_TIER_LIMITS = {
    maxWorkspaces: 50,
    maxNodesPerWorkspace: 500,
    maxAiGenerationsPerDay: 500,
    maxStorageMb: 5120,
} as const;

export interface TierLimitsConfig {
    readonly maxWorkspaces: number;
    readonly maxNodesPerWorkspace: number;
    readonly maxAiGenerationsPerDay: number;
    readonly maxStorageMb: number;
}

// ── Reducer State ────────────────────────────────────────────────────────────

export interface TierLimitsState {
    readonly workspaceCount: number;
    readonly nodeCount: number;
    readonly aiDailyCount: number;
    readonly aiDailyDate: string; // ISO date 'YYYY-MM-DD'
    readonly storageMb: number;
    readonly isLoaded: boolean;
}

export const INITIAL_TIER_LIMITS_STATE: TierLimitsState = {
    workspaceCount: 0,
    nodeCount: 0,
    aiDailyCount: 0,
    aiDailyDate: '',
    storageMb: 0,
    isLoaded: false,
};

// ── Reducer Actions ──────────────────────────────────────────────────────────

export type TierLimitsAction =
    | { type: 'USAGE_LOADED'; payload: Partial<TierLimitsState> }
    | { type: 'WORKSPACE_COUNT_CHANGED'; count: number }
    | { type: 'NODE_COUNT_CHANGED'; count: number }
    | { type: 'AI_GENERATED' }
    | { type: 'AI_DAILY_LOADED'; count: number; date: string }
    | { type: 'STORAGE_UPDATED'; storageMb: number }
    | { type: 'RESET' };

// ── Limit Check Types ────────────────────────────────────────────────────────

export type LimitKind = 'workspace' | 'node' | 'aiDaily' | 'storage';

export interface LimitCheckResult {
    readonly allowed: boolean;
    readonly current: number;
    readonly max: number;
    readonly kind: LimitKind;
}

/** Returns the limit config for a given subscription tier. */
export function getLimitsForTier(tier: SubscriptionTier): TierLimitsConfig {
    return tier === 'pro' ? PRO_TIER_LIMITS : FREE_TIER_LIMITS;
}
