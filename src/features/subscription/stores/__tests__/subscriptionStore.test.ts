/**
 * Subscription Store Tests
 * TDD: Verifies reactive subscription state and feature access
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useSubscriptionStore } from '../subscriptionStore';
import { SUBSCRIPTION_TIERS, GATED_FEATURES } from '../../types/subscription';

// Mock subscription service
const mockGetSubscription = vi.fn();
vi.mock('../../services/subscriptionService', () => ({
    subscriptionService: {
        getSubscription: (...args: unknown[]) => mockGetSubscription(...args),
        clearCache: vi.fn(),
        DEFAULT_SUBSCRIPTION: {
            tier: 'free',
            expiresAt: null,
            isActive: true,
        },
    },
}));

describe('subscriptionStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useSubscriptionStore.setState({
            tier: SUBSCRIPTION_TIERS.free,
            isLoading: false,
            isActive: true,
        });
    });

    it('defaults to free tier', () => {
        const state = useSubscriptionStore.getState();
        expect(state.tier).toBe(SUBSCRIPTION_TIERS.free);
        expect(state.isActive).toBe(true);
        expect(state.isLoading).toBe(false);
    });

    it('loads pro subscription from service', async () => {
        mockGetSubscription.mockResolvedValue({
            tier: SUBSCRIPTION_TIERS.pro,
            expiresAt: null,
            isActive: true,
        });

        await act(async () => {
            await useSubscriptionStore.getState().loadSubscription('user-1');
        });

        expect(useSubscriptionStore.getState().tier).toBe(SUBSCRIPTION_TIERS.pro);
    });

    it('hasAccess returns true for pro features on pro tier', async () => {
        useSubscriptionStore.setState({ tier: SUBSCRIPTION_TIERS.pro, isActive: true });
        expect(useSubscriptionStore.getState().hasAccess(GATED_FEATURES.offlinePin)).toBe(true);
    });

    it('hasAccess returns false for pro features on free tier', () => {
        useSubscriptionStore.setState({ tier: SUBSCRIPTION_TIERS.free, isActive: true });
        expect(useSubscriptionStore.getState().hasAccess(GATED_FEATURES.offlinePin)).toBe(false);
    });

    it('hasAccess returns false when isActive=false even on pro tier', () => {
        useSubscriptionStore.setState({ tier: SUBSCRIPTION_TIERS.pro, isActive: false });
        expect(useSubscriptionStore.getState().hasAccess(GATED_FEATURES.offlinePin)).toBe(false);
    });

    it('hasAccess returns false for documentIntelligence on free tier', () => {
        useSubscriptionStore.setState({ tier: SUBSCRIPTION_TIERS.free, isActive: true });
        expect(useSubscriptionStore.getState().hasAccess(GATED_FEATURES.documentIntelligence)).toBe(false);
    });

    it('hasAccess returns true for documentIntelligence on pro tier', () => {
        useSubscriptionStore.setState({ tier: SUBSCRIPTION_TIERS.pro, isActive: true });
        expect(useSubscriptionStore.getState().hasAccess(GATED_FEATURES.documentIntelligence)).toBe(true);
    });

    it('hasAccess returns false for documentIntelligence on free tier', () => {
        useSubscriptionStore.setState({ tier: SUBSCRIPTION_TIERS.free, isActive: true });
        expect(useSubscriptionStore.getState().hasAccess(GATED_FEATURES.documentIntelligence)).toBe(false);
    });

    it('sets isLoading during load', async () => {
        let resolvePromise: (v: unknown) => void = () => {};
        mockGetSubscription.mockReturnValue(
            new Promise((r) => { resolvePromise = r; })
        );

        const loadPromise = act(async () => {
            void useSubscriptionStore.getState().loadSubscription('user-1');
        });

        expect(useSubscriptionStore.getState().isLoading).toBe(true);

        resolvePromise({
            tier: SUBSCRIPTION_TIERS.free,
            expiresAt: null,
            isActive: true,
        });

        await loadPromise;
    });

    it('resets to free tier on reset', () => {
        useSubscriptionStore.setState({ tier: SUBSCRIPTION_TIERS.pro });
        useSubscriptionStore.getState().reset();
        expect(useSubscriptionStore.getState().tier).toBe(SUBSCRIPTION_TIERS.free);
    });
});
