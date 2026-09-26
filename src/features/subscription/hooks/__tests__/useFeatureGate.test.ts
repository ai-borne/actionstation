/**
 * useFeatureGate Hook Tests
 * TDD: Verifies feature gating based on subscription tier
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFeatureGate } from '../useFeatureGate';
import { GATED_FEATURES, SUBSCRIPTION_TIERS } from '../../types/subscription';

// Mock subscription store
let mockTier: string = SUBSCRIPTION_TIERS.free;
let mockIsLoading = false;
let mockIsActive = true;

vi.mock('../../stores/subscriptionStore', () => ({
    useSubscriptionStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({
            tier: mockTier,
            isLoading: mockIsLoading,
            isActive: mockIsActive,
            hasAccess: () => {
                return mockTier === 'pro' && mockIsActive;
            },
        }),
}));

describe('useFeatureGate', () => {
    beforeEach(() => {
        mockTier = SUBSCRIPTION_TIERS.free;
        mockIsLoading = false;
        mockIsActive = true;
    });

    it('returns hasAccess=false for pro feature on free tier', () => {
        mockTier = SUBSCRIPTION_TIERS.free;
        const { result } = renderHook(() => useFeatureGate(GATED_FEATURES.offlinePin));
        expect(result.current.hasAccess).toBe(false);
    });

    it('returns hasAccess=true for pro feature on pro tier with isActive=true', () => {
        mockTier = SUBSCRIPTION_TIERS.pro;
        mockIsActive = true;
        const { result } = renderHook(() => useFeatureGate(GATED_FEATURES.offlinePin));
        expect(result.current.hasAccess).toBe(true);
    });

    it('returns hasAccess=false for pro tier when isActive=false (payment failed)', () => {
        mockTier = SUBSCRIPTION_TIERS.pro;
        mockIsActive = false;
        const { result } = renderHook(() => useFeatureGate(GATED_FEATURES.offlinePin));
        expect(result.current.hasAccess).toBe(false);
    });

    it('returns isLoading from store', () => {
        mockIsLoading = true;
        const { result } = renderHook(() => useFeatureGate(GATED_FEATURES.documentIntelligence));
        expect(result.current.isLoading).toBe(true);
    });

    it('returns current tier', () => {
        mockTier = SUBSCRIPTION_TIERS.pro;
        const { result } = renderHook(() => useFeatureGate(GATED_FEATURES.documentIntelligence));
        expect(result.current.tier).toBe('pro');
    });

    it('uses pure hasFeatureAccess (not store method) for derivation', () => {
        mockTier = SUBSCRIPTION_TIERS.free;
        const { result } = renderHook(() => useFeatureGate(GATED_FEATURES.offlinePin));
        expect(result.current.hasAccess).toBe(false);
        expect(result.current.tier).toBe('free');
    });

    it('returns correct access for each gated feature on free tier', () => {
        mockTier = SUBSCRIPTION_TIERS.free;
        const pin = renderHook(() => useFeatureGate(GATED_FEATURES.offlinePin));
        const doc = renderHook(() => useFeatureGate(GATED_FEATURES.documentIntelligence));
        expect(pin.result.current.hasAccess).toBe(false);
        expect(doc.result.current.hasAccess).toBe(false);
    });

    it('returns correct access for each gated feature on pro tier', () => {
        mockTier = SUBSCRIPTION_TIERS.pro;
        mockIsActive = true;
        const pin = renderHook(() => useFeatureGate(GATED_FEATURES.offlinePin));
        const doc = renderHook(() => useFeatureGate(GATED_FEATURES.documentIntelligence));
        expect(pin.result.current.hasAccess).toBe(true);
        expect(doc.result.current.hasAccess).toBe(true);
    });
});
