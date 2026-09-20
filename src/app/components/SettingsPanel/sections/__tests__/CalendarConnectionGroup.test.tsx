/**
 * CalendarConnectionGroup — the View for Settings → Account → Google Calendar (checklist A10c).
 * Pure rendering over useCalendarConnection: status text, and the Connect / Disconnect button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarConnectionGroup } from '../CalendarConnectionGroup';
import { calendarStrings as cs } from '@/features/calendar/localization/calendarStrings';

let mockState = { isConnected: false, isBusy: false };
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
vi.mock('@/features/calendar/hooks/useCalendarConnection', () => ({
    useCalendarConnection: () => ({ ...mockState, connect: mockConnect, disconnect: mockDisconnect }),
}));

describe('CalendarConnectionGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockState = { isConnected: false, isBusy: false };
        // The hook's connect/disconnect return Promise<void>; the mocks must honour that contract.
        mockConnect.mockResolvedValue(undefined);
        mockDisconnect.mockResolvedValue(undefined);
    });

    it('when not connected: explains it and offers Connect only', () => {
        render(<CalendarConnectionGroup />);

        expect(screen.getByRole('heading', { name: cs.connection.title })).toBeInTheDocument();
        expect(screen.getByText(cs.connection.notConnectedDescription)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: cs.connection.disconnect })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: cs.connection.connect }));
        expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('when connected: says so and offers Disconnect only', () => {
        mockState = { isConnected: true, isBusy: false };
        render(<CalendarConnectionGroup />);

        expect(screen.getByText(cs.connection.connectedDescription)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: cs.connection.connect })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: cs.connection.disconnect }));
        expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it('disables the button and shows progress text while busy', () => {
        mockState = { isConnected: true, isBusy: true };
        render(<CalendarConnectionGroup />);

        const button = screen.getByRole('button', { name: cs.connection.disconnecting });
        expect(button).toBeDisabled();
    });
});
