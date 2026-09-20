/**
 * Calendar E2E Integration Tests
 * Tests full flow: service -> store -> badge display
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';

vi.mock('../services/serverCalendarClient', () => ({
    REAUTH_REQUIRED: 'REAUTH_REQUIRED',
    serverCreateEvent: vi.fn(),
    serverDeleteEvent: vi.fn(),
    serverUpdateEvent: vi.fn(),
    serverListEvents: vi.fn(),
}));

// eslint-disable-next-line import-x/first
import { serverCreateEvent, serverDeleteEvent, serverUpdateEvent } from '../services/serverCalendarClient';
// eslint-disable-next-line import-x/first
import { useCalendarSync } from '../hooks/useCalendarSync';
// eslint-disable-next-line import-x/first
import { startCalendarSync } from '../services/calendarSyncController';
// eslint-disable-next-line import-x/first
import { CALENDAR_UPDATE_DEBOUNCE_MS, CALENDAR_DELETE_GRACE_MS } from '../config/syncTiming';
// eslint-disable-next-line import-x/first
import { useAuthStore } from '@/features/auth/stores/authStore';
// eslint-disable-next-line import-x/first
import { useTabRoleStore } from '@/shared/stores/tabRoleStore';
// eslint-disable-next-line import-x/first
import { CalendarBadge } from '../components/CalendarBadge';
// eslint-disable-next-line import-x/first
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';
// eslint-disable-next-line import-x/first
import type { CalendarEventMetadata } from '../types/calendarEvent';
// eslint-disable-next-line import-x/first
import { calendarStrings as cs } from '../localization/calendarStrings';

describe('Calendar E2E Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useCanvasStore.setState({
            nodes: [{
                id: 'e2e-node', workspaceId: 'ws-1', type: 'idea',
                data: { heading: 'Plan retrospective' }, position: { x: 0, y: 0 },
                createdAt: new Date(), updatedAt: new Date(),
            }],
            edges: [], selectedNodeIds: new Set(),
        });
    });

    it('full create flow: API call -> store update -> badge data', async () => {
        (serverCreateEvent as Mock).mockResolvedValue({
            id: 'gcal-e2e-1', type: 'event', title: 'Sprint retro',
            date: '2026-02-20T14:00:00Z', endDate: '2026-02-20T15:00:00Z',
            notes: 'Review outcomes', status: 'synced', syncedAt: Date.now(),
            calendarId: 'primary',
        });

        const { result } = renderHook(() => useCalendarSync('e2e-node'));

        await act(async () => {
            await result.current.syncCreate('event', 'Sprint retro', '2026-02-20T14:00:00Z', '2026-02-20T15:00:00Z', 'Review outcomes');
        });

        expect(serverCreateEvent).toHaveBeenCalledWith(
            'event', 'Sprint retro', '2026-02-20T14:00:00Z', '2026-02-20T15:00:00Z', 'Review outcomes',
        );

        const node = useCanvasStore.getState().nodes.find(n => n.id === 'e2e-node')!;
        expect(node.data.calendarEvent).toBeDefined();
        expect(node.data.calendarEvent!.id).toBe('gcal-e2e-1');
        expect(node.data.calendarEvent!.status).toBe('synced');
    });

    it('badge displays correct synced state', () => {
        const meta: CalendarEventMetadata = {
            id: 'gcal-1', type: 'event', title: 'Team sync',
            date: '2026-02-20T10:00:00Z', status: 'synced',
            syncedAt: Date.now(), calendarId: 'primary',
        };

        render(<CalendarBadge metadata={meta} onClick={vi.fn()} />);

        expect(screen.getByText('Team sync')).toBeInTheDocument();
        expect(screen.getByTestId('calendar-badge')).toHaveAttribute('data-status', 'synced');
    });

    it('badge displays failed state with retry', () => {
        const meta: CalendarEventMetadata = {
            id: '', type: 'event', title: 'Failed event',
            date: '2026-02-20T10:00:00Z', status: 'failed',
            calendarId: 'primary', error: 'Network error',
        };
        const onRetry = vi.fn();

        render(<CalendarBadge metadata={meta} onClick={vi.fn()} onRetry={onRetry} />);

        expect(screen.getByTestId('calendar-badge')).toHaveAttribute('data-status', 'failed');
        fireEvent.click(screen.getByTitle(cs.badge.retry));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('failed sync sets error status on node', async () => {
        (serverCreateEvent as Mock).mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useCalendarSync('e2e-node'));

        await act(async () => {
            await result.current.syncCreate('event', 'Bad event', '2026-02-20T10:00:00Z');
        });

        const node = useCanvasStore.getState().nodes.find(n => n.id === 'e2e-node')!;
        expect(node.data.calendarEvent?.status).toBe('failed');
        expect(result.current.error).toBeTruthy();
    });

    describe('background sync through the real chain (store -> signal -> controller -> server client)', () => {
        const synced: CalendarEventMetadata = {
            id: 'gcal-bg-1', type: 'event', title: 'Plan retrospective',
            date: '2026-02-20T10:00:00Z', notes: 'agenda', status: 'synced',
            syncedAt: Date.now(), calendarId: 'primary',
        };
        let stopSync: () => void;

        beforeEach(() => {
            vi.useFakeTimers();
            useAuthStore.setState({ isCalendarConnected: true });
            useTabRoleStore.setState({ isLeader: true });
            useCanvasStore.getState().setNodeCalendarEvent('e2e-node', synced);
            stopSync = startCalendarSync();
        });
        afterEach(() => { stopSync(); vi.useRealTimers(); });

        it('editing the heading updates the Google event title', async () => {
            (serverUpdateEvent as Mock).mockImplementation((id: string, type: string, title: string, date: string, endDate?: string, notes?: string) =>
                Promise.resolve({ id, type, title, date, endDate, notes, status: 'synced', syncedAt: 1, calendarId: 'primary' }));

            useCanvasStore.getState().updateNodeHeading('e2e-node', 'Plan the retrospective');
            await vi.advanceTimersByTimeAsync(CALENDAR_UPDATE_DEBOUNCE_MS);

            expect(serverUpdateEvent).toHaveBeenCalledWith(
                'gcal-bg-1', 'event', 'Plan the retrospective', '2026-02-20T10:00:00Z', undefined, 'agenda',
            );
            const node = useCanvasStore.getState().nodes.find(n => n.id === 'e2e-node')!;
            expect(node.data.calendarEvent).toMatchObject({ title: 'Plan the retrospective', status: 'synced' });
        });

        it('deleting the card deletes the Google event after the undo window', async () => {
            (serverDeleteEvent as Mock).mockResolvedValue(undefined);

            useCanvasStore.getState().deleteNode('e2e-node');
            expect(serverDeleteEvent).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(CALENDAR_DELETE_GRACE_MS);

            expect(serverDeleteEvent).toHaveBeenCalledWith('gcal-bg-1');
        });
    });
});
