/**
 * SubscriptionBillingGroup Tests — Razorpay vs Stripe billing UI
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubscriptionBillingGroup } from '../SubscriptionBillingGroup';
import { strings } from '@/shared/localization/strings';

const mockStartCheckout = vi.fn();
const mockOpenBillingPortal = vi.fn();

let mockTier = 'free';
let mockIsActive = true;
let mockProvider: 'stripe' | 'razorpay' | null = null;

vi.mock('@/features/subscription/stores/subscriptionStore', () => ({
    useSubscriptionStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({
            tier: mockTier,
            isActive: mockIsActive,
            provider: mockProvider,
        }),
}));

vi.mock('@/features/subscription/hooks/useBillingPortal', () => ({
    useBillingPortal: () => ({
        openBillingPortal: mockOpenBillingPortal,
        isLoading: false,
        error: null,
    }),
}));

vi.mock('@/features/subscription/hooks/useRazorpayCheckout', () => ({
    useRazorpayCheckout: () => ({
        startCheckout: mockStartCheckout,
        isLoading: false,
        error: null,
    }),
}));

vi.mock('@/shared/stores/toastStore', () => ({
    toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/shared/services/logger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

describe('SubscriptionBillingGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTier = 'free';
        mockIsActive = true;
        mockProvider = null;
        mockStartCheckout.mockResolvedValue(undefined);
    });

    it('shows Razorpay upgrade CTA for free users', () => {
        render(<SubscriptionBillingGroup />);
        expect(screen.getByText(strings.subscription.upgradeAnnualCta)).toBeInTheDocument();
    });

    it('starts Razorpay checkout when free user clicks upgrade', () => {
        render(<SubscriptionBillingGroup />);
        fireEvent.click(screen.getByText(strings.subscription.upgradeAnnualCta));
        expect(mockStartCheckout).toHaveBeenCalled();
    });

    it('shows Stripe manage billing for pro Stripe subscribers', () => {
        mockTier = 'pro';
        mockProvider = 'stripe';
        render(<SubscriptionBillingGroup />);
        expect(screen.getByText(strings.subscription.manageBilling)).toBeInTheDocument();
        expect(screen.queryByText(strings.subscription.razorpayManageBilling)).not.toBeInTheDocument();
    });

    it('shows Razorpay manage copy instead of Stripe portal for pro Razorpay subscribers', () => {
        mockTier = 'pro';
        mockProvider = 'razorpay';
        render(<SubscriptionBillingGroup />);
        expect(screen.getByText(strings.subscription.razorpayManageBilling)).toBeInTheDocument();
        expect(screen.queryByText(strings.subscription.manageBilling)).not.toBeInTheDocument();
    });
});
