/**
 * AccountSection composes the Google Calendar card (checklist A10c): it must appear on the Account
 * tab, before the destructive Danger Zone, and only for a signed-in user.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { AccountSection } from '../AccountSection';

vi.mock('../CalendarConnectionGroup', () => ({ CalendarConnectionGroup: () => <div data-testid="calendar-group" /> }));
vi.mock('../SubscriptionBillingGroup', () => ({ SubscriptionBillingGroup: () => null }));
vi.mock('../AccountUsageGroup', () => ({ AccountUsageGroup: () => null }));
vi.mock('../DangerZone', () => ({ DangerZone: () => <div data-testid="danger-zone" /> }));
vi.mock('@/features/auth/services/authService', () => ({ signOut: vi.fn() }));
vi.mock('@/features/workspace/hooks/useDataExport', () => ({ useDataExport: () => ({ exportData: vi.fn() }) }));
vi.mock('@/features/workspace/hooks/useGdprExport', () => ({
    useGdprExport: () => ({ exportAll: vi.fn(), isExporting: false }),
}));

describe('AccountSection: Google Calendar card', () => {
    beforeEach(() => {
        useAuthStore.setState({
            user: { id: 'u1', name: 'Test User', email: 't@example.com', avatarUrl: '', createdAt: new Date(0) },
        });
    });

    it('renders the calendar card before the danger zone', () => {
        render(<AccountSection />);

        const card = screen.getByTestId('calendar-group');
        const danger = screen.getByTestId('danger-zone');
        expect(card.compareDocumentPosition(danger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders nothing when signed out', () => {
        useAuthStore.setState({ user: null });
        const { container } = render(<AccountSection />);
        expect(container).toBeEmptyDOMElement();
    });
});
