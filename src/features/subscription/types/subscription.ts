/**
 * Subscription Types - SSOT for tier definitions and feature flags
 * All feature gating logic references these types.
 */

export const SUBSCRIPTION_TIERS = {
    free: 'free',
    pro: 'pro',
} as const;

export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[keyof typeof SUBSCRIPTION_TIERS];

/** Features that can be gated behind a subscription */
export const GATED_FEATURES = {
    offlinePin: 'offlinePin',
    backgroundSync: 'backgroundSync',
    documentIntelligence: 'documentIntelligence',
} as const;

export type GatedFeature = (typeof GATED_FEATURES)[keyof typeof GATED_FEATURES];

/** Maps each feature to the minimum tier required */
export const FEATURE_TIER_MAP: Record<GatedFeature, SubscriptionTier> = {
    [GATED_FEATURES.offlinePin]: SUBSCRIPTION_TIERS.pro,
    [GATED_FEATURES.backgroundSync]: SUBSCRIPTION_TIERS.pro,
    [GATED_FEATURES.documentIntelligence]: SUBSCRIPTION_TIERS.pro,
};

/** Active Razorpay annual plan ID — SSOT (used by checkout, upgrade CTAs) */
export const PRO_ANNUAL_PLAN_ID = 'plan_SWtIj1spzXCZbR';

/** @deprecated Use PRO_ANNUAL_PLAN_ID — kept for existing imports */
export const PRO_MONTHLY_PLAN_ID = PRO_ANNUAL_PLAN_ID;

/** Core subscription info (read by client, written by webhook) */
export interface SubscriptionInfo {
    tier: SubscriptionTier;
    expiresAt: number | null;
    isActive: boolean;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string | null;
    stripePriceId?: string | null;
    currentPeriodEnd?: number | null;
    cancelAtPeriodEnd?: boolean;
    currency?: string;
    /** Payment provider: 'stripe' | 'razorpay' — determines which billing portal to open */
    provider?: 'stripe' | 'razorpay';
}

/** Pricing plan for display in PricingCard */
export interface PricingPlan {
    priceId: string;
    name: string;
    interval: 'month' | 'year';
    amount: number;
    currency: 'inr' | 'usd';
    displayPrice: string;
}

/** Tier hierarchy: pro > free */
const TIER_RANK: Record<SubscriptionTier, number> = {
    [SUBSCRIPTION_TIERS.free]: 0,
    [SUBSCRIPTION_TIERS.pro]: 1,
};

/**
 * Check if a tier has access to a specific feature.
 * isActive defaults to true — pass store value to block delinquent subscriptions.
 */
export function hasFeatureAccess(
    tier: SubscriptionTier,
    feature: GatedFeature,
    isActive = true,
): boolean {
    if (!isActive) return false;
    const requiredTier = FEATURE_TIER_MAP[feature];
    return TIER_RANK[tier] >= TIER_RANK[requiredTier];
}
