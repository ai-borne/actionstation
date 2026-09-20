/**
 * AccountUsageGroup Tests — free tier usage meters
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountUsageGroup } from '../AccountUsageGroup';
import { strings } from '@/shared/localization/strings';
import { FREE_TIER_LIMITS } from '@/features/subscription/types/tierLimits';

let mockTier = 'free';

const mockCheck = vi.fn();

vi.mock('@/features/subscription/stores/subscriptionStore', () => ({
    useSubscriptionStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ tier: mockTier }),
}));

vi.mock('@/features/subscription/hooks/useTierLimits', () => ({
    useTierLimits: () => ({ check: mockCheck }),
}));

describe('AccountUsageGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTier = 'free';
        mockCheck.mockImplementation((kind: string) => ({
            allowed: true,
            current: kind === 'storage' ? 10 : 1,
            max: FREE_TIER_LIMITS.maxStorageMb,
        }));
    });

    it('renders usage meters for free users', () => {
        render(<AccountUsageGroup />);
        expect(screen.getByText(strings.settings.usageGroup)).toBeInTheDocument();
        expect(screen.getByText(strings.landing.pricing.labels.workspaces)).toBeInTheDocument();
        expect(screen.getByText(strings.landing.pricing.labels.storage)).toBeInTheDocument();
    });

    it('renders nothing for pro users', () => {
        mockTier = 'pro';
        const { container } = render(<AccountUsageGroup />);
        expect(container).toBeEmptyDOMElement();
    });
});
