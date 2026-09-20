/**
 * Subscription Store - Reactive state for subscription tier
 * SOLID SRP: Only manages subscription state and feature access
 */
import { create } from 'zustand';
import { subscriptionService } from '../services/subscriptionService';
import {
    SUBSCRIPTION_TIERS,
    hasFeatureAccess,
    type SubscriptionTier,
    type GatedFeature,
    type SubscriptionInfo,
} from '../types/subscription';

interface SubscriptionState {
    tier: SubscriptionTier;
    isLoading: boolean;
    isActive: boolean;
    provider: SubscriptionInfo['provider'];
}

interface SubscriptionActions {
    loadSubscription: (userId: string) => Promise<void>;
    hasAccess: (feature: GatedFeature) => boolean;
    reset: () => void;
}

type SubscriptionStore = SubscriptionState & SubscriptionActions;

export const useSubscriptionStore = create<SubscriptionStore>()((set, get) => ({
    tier: SUBSCRIPTION_TIERS.free,
    isLoading: false,
    isActive: true,
    provider: undefined,

    loadSubscription: async (userId: string) => {
        set({ isLoading: true });
        try {
            subscriptionService.clearCache();
            const info = await subscriptionService.getSubscription(userId);
            set({
                tier: info.tier,
                isActive: info.isActive,
                provider: info.provider,
            });
        } finally {
            set({ isLoading: false });
        }
    },

    hasAccess: (feature: GatedFeature) => {
        const { tier, isActive } = get();
        return hasFeatureAccess(tier, feature, isActive);
    },

    reset: () => {
        subscriptionService.clearCache();
        set({
            tier: SUBSCRIPTION_TIERS.free,
            isLoading: false,
            isActive: true,
            provider: undefined,
        });
    },
}));
