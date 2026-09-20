/**
 * DangerZone Tests — a Pro user is told the plan is not refunded automatically (B7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DangerZone } from '../DangerZone';
import { strings } from '@/shared/localization/strings';

const mockConfirm = vi.fn();
const mockDeleteAccount = vi.fn();
let mockTier = 'free';
let mockIsActive = true;

vi.mock('@/shared/stores/confirmStore', () => ({ useConfirm: () => mockConfirm }));
vi.mock('@/features/auth/services/authService', () => ({
    deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
}));
vi.mock('@/features/subscription/stores/subscriptionStore', () => ({
    useSubscriptionStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ tier: mockTier, isActive: mockIsActive }),
}));
vi.mock('@/shared/stores/toastStore', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe('DangerZone', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTier = 'free';
        mockIsActive = true;
        mockConfirm.mockResolvedValue(false);
    });

    it('shows the standard warning for a free user', async () => {
        render(<DangerZone />);
        fireEvent.click(screen.getByText(strings.settings.deleteAccount));
        await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
        expect(mockConfirm).toHaveBeenCalledWith(
            expect.objectContaining({ message: strings.settings.deleteAccountConfirm }),
        );
    });

    it('warns an active Pro user that the plan is not refunded automatically', async () => {
        mockTier = 'pro';
        render(<DangerZone />);
        fireEvent.click(screen.getByText(strings.settings.deleteAccount));
        await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
        expect(mockConfirm).toHaveBeenCalledWith(
            expect.objectContaining({ message: strings.settings.deleteAccountConfirmPro }),
        );
        expect(strings.settings.deleteAccountConfirmPro).toContain('refund');
    });

    it('does not delete when the user cancels the dialog', async () => {
        render(<DangerZone />);
        fireEvent.click(screen.getByText(strings.settings.deleteAccount));
        await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
        expect(mockDeleteAccount).not.toHaveBeenCalled();
    });
});
