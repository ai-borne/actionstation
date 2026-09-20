/**
 * SubscriptionBillingGroup Tests — Razorpay is the only billing UI (Stripe is deferred, B8)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubscriptionBillingGroup } from '../SubscriptionBillingGroup';
import { strings } from '@/shared/localization/strings';
import { REFUND_WINDOW_DAYS } from '@/features/subscription/types/pricing';

const mockStartCheckout = vi.fn();

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

    it.each(['razorpay', null] as const)(
        'shows the annual-plan and refund copy, and no billing-portal button, for a pro user with provider %s',
        (provider) => {
            mockTier = 'pro';
            mockProvider = provider;
            render(<SubscriptionBillingGroup />);
            expect(screen.getByText(strings.subscription.razorpayManageBilling)).toBeInTheDocument();
            expect(screen.queryByRole('button')).not.toBeInTheDocument();
        },
    );

    it('points a legacy Stripe pro user to support instead of a billing portal', () => {
        mockTier = 'pro';
        mockProvider = 'stripe';
        render(<SubscriptionBillingGroup />);
        expect(screen.getByText(strings.subscription.legacyStripeBilling)).toBeInTheDocument();
        expect(screen.queryByText(strings.subscription.razorpayManageBilling)).not.toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('states the refund window from the SSOT constant', () => {
        expect(strings.subscription.razorpayManageBilling).toContain(`${REFUND_WINDOW_DAYS} days`);
    });
});
