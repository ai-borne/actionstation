/**
 * useCalendarSync Tests - TDD: Written FIRST (RED phase)
 * Tests bridge between service layer and Zustand store
 */
 
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../services/calendarService', () => ({
    createEvent: vi.fn(),
    deleteEvent: vi.fn(),
    updateEvent: vi.fn(),
}));

vi.mock('@/features/auth/services/calendarAuthService', () => ({
    disconnectGoogleCalendar: vi.fn(),
}));

vi.mock('@/shared/stores/toastStore', () => ({
    toast: { error: vi.fn(), success: vi.fn() },
}));

// eslint-disable-next-line import-x/first
import { createEvent, updateEvent } from '../services/calendarService';
// eslint-disable-next-line import-x/first
import { disconnectGoogleCalendar } from '@/features/auth/services/calendarAuthService';
// eslint-disable-next-line import-x/first
import { toast } from '@/shared/stores/toastStore';
// eslint-disable-next-line import-x/first
import { useCalendarSync } from '../hooks/useCalendarSync';
// eslint-disable-next-line import-x/first
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';
// eslint-disable-next-line import-x/first
import { REAUTH_REQUIRED } from '../services/serverCalendarClient';
// eslint-disable-next-line import-x/first
import { calendarStrings as cs } from '../localization/calendarStrings';

const mockMetadata = {
    id: 'gcal-1',
    type: 'event' as const,
    title: 'Team standup',
    date: '2026-02-20T10:00:00Z',
    status: 'synced' as const,
    syncedAt: Date.now(),
    calendarId: 'primary',
};

describe('useCalendarSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useCanvasStore.setState({
            nodes: [{
                id: 'node-1', workspaceId: 'ws-1', type: 'idea',
                data: { heading: 'Test' }, position: { x: 0, y: 0 },
                createdAt: new Date(), updatedAt: new Date(),
            }],
            edges: [],
            selectedNodeIds: new Set(),
        });
    });

    it('should create event and update store', async () => {
        (createEvent as Mock).mockResolvedValue(mockMetadata);

        const { result } = renderHook(() => useCalendarSync('node-1'));

        await act(async () => {
            await result.current.syncCreate('event', 'Team standup', '2026-02-20T10:00:00Z');
        });

        expect(createEvent).toHaveBeenCalledWith('event', 'Team standup', '2026-02-20T10:00:00Z', undefined, undefined);
        const node = useCanvasStore.getState().nodes.find(n => n.id === 'node-1')!;
        expect(node.data.calendarEvent).toEqual(mockMetadata);
    });

    it('should set loading state during sync', async () => {
        let resolvePromise: (v: typeof mockMetadata) => void;
        (createEvent as Mock).mockReturnValue(new Promise(r => { resolvePromise = r; }));

        const { result } = renderHook(() => useCalendarSync('node-1'));

        let syncPromise: Promise<void>;
        act(() => {
            syncPromise = result.current.syncCreate('event', 'Test', '2026-02-20T10:00:00Z');
        });

        expect(result.current.isLoading).toBe(true);

        await act(async () => {
            resolvePromise!(mockMetadata);
            await syncPromise;
        });

        expect(result.current.isLoading).toBe(false);
    });

    it('should handle create errors and set failed status', async () => {
        (createEvent as Mock).mockRejectedValue(new Error('API error'));

        const { result } = renderHook(() => useCalendarSync('node-1'));

        await act(async () => {
            await result.current.syncCreate('event', 'Test', '2026-02-20T10:00:00Z');
        });

        expect(result.current.error).toBe('API error');
        const node = useCanvasStore.getState().nodes.find(n => n.id === 'node-1')!;
        expect(node.data.calendarEvent?.status).toBe('failed');
    });

    describe('syncUpdate', () => {
        it('should update event and update store on success', async () => {
            const updatedMeta = { ...mockMetadata, title: 'Updated standup' };
            (updateEvent as Mock).mockResolvedValue(updatedMeta);
            useCanvasStore.getState().setNodeCalendarEvent('node-1', mockMetadata);

            const { result } = renderHook(() => useCalendarSync('node-1'));

            await act(async () => {
                await result.current.syncUpdate('gcal-1', 'event', 'Updated standup', '2026-02-20T10:00:00Z');
            });

            expect(updateEvent).toHaveBeenCalledWith('gcal-1', 'event', 'Updated standup', '2026-02-20T10:00:00Z', undefined, undefined);
            const node = useCanvasStore.getState().nodes.find(n => n.id === 'node-1')!;
            expect(node.data.calendarEvent).toEqual(updatedMeta);
        });

        it('should set loading state during update', async () => {
            let resolvePromise: (v: typeof mockMetadata) => void;
            (updateEvent as Mock).mockReturnValue(new Promise(r => { resolvePromise = r; }));

            const { result } = renderHook(() => useCalendarSync('node-1'));

            let updatePromise: Promise<void>;
            act(() => {
                updatePromise = result.current.syncUpdate('gcal-1', 'event', 'Test', '2026-02-20T10:00:00Z');
            });

            expect(result.current.isLoading).toBe(true);

            await act(async () => {
                resolvePromise!(mockMetadata);
                await updatePromise;
            });

            expect(result.current.isLoading).toBe(false);
        });

        it('should set failed status on node when update fails', async () => {
            (updateEvent as Mock).mockRejectedValue(new Error('Update API error'));
            useCanvasStore.getState().setNodeCalendarEvent('node-1', mockMetadata);

            const { result } = renderHook(() => useCalendarSync('node-1'));

            await act(async () => {
                await result.current.syncUpdate('gcal-1', 'event', 'Test', '2026-02-20T10:00:00Z');
            });

            expect(result.current.error).toBe('Update API error');
            const node = useCanvasStore.getState().nodes.find(n => n.id === 'node-1')!;
            expect(node.data.calendarEvent?.status).toBe('failed');
            expect(node.data.calendarEvent?.error).toBe('Update API error');
        });
    });

    it('should clear error on successful sync', async () => {
        (createEvent as Mock).mockRejectedValueOnce(new Error('Fail'));

        const { result } = renderHook(() => useCalendarSync('node-1'));

        await act(async () => {
            await result.current.syncCreate('event', 'Test', '2026-02-20T10:00:00Z');
        });
        expect(result.current.error).toBe('Fail');

        (createEvent as Mock).mockResolvedValueOnce(mockMetadata);
        await act(async () => {
            await result.current.syncCreate('event', 'Test', '2026-02-20T10:00:00Z');
        });
        expect(result.current.error).toBeNull();
    });
});

describe('useCalendarSync — REAUTH_REQUIRED paths', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useCanvasStore.setState({
            nodes: [{
                id: 'node-1', workspaceId: 'ws-1', type: 'idea',
                data: { heading: 'Test' }, position: { x: 0, y: 0 },
                createdAt: new Date(), updatedAt: new Date(),
            }],
            edges: [],
            selectedNodeIds: new Set(),
        });
    });

    it('syncCreate with REAUTH_REQUIRED disconnects, toasts, and sets sessionExpired error', async () => {
        (createEvent as Mock).mockRejectedValue(new Error(REAUTH_REQUIRED));

        const { result } = renderHook(() => useCalendarSync('node-1'));
        await act(async () => {
            await result.current.syncCreate('event', 'Test', '2026-02-20T10:00:00Z');
        });

        expect(disconnectGoogleCalendar).toHaveBeenCalledOnce();
        expect(toast.error)
            .toHaveBeenCalledWith(cs.errors.sessionExpired);
        expect(result.current.error).toBe(cs.errors.sessionExpired);
        const node = useCanvasStore.getState().nodes.find((n) => n.id === 'node-1')!;
        expect(node.data.calendarEvent?.status).toBe('failed');
        expect(node.data.calendarEvent?.error).toBe(cs.errors.sessionExpired);
    });

    it('syncUpdate with REAUTH_REQUIRED disconnects, toasts, and sets sessionExpired error', async () => {
        (updateEvent as Mock).mockRejectedValue(new Error(REAUTH_REQUIRED));
        useCanvasStore.getState().setNodeCalendarEvent('node-1', mockMetadata);

        const { result } = renderHook(() => useCalendarSync('node-1'));
        await act(async () => {
            await result.current.syncUpdate('gcal-1', 'event', 'Test', '2026-02-20T10:00:00Z');
        });

        expect(disconnectGoogleCalendar).toHaveBeenCalledOnce();
        expect(toast.error)
            .toHaveBeenCalledWith(cs.errors.sessionExpired);
        expect(result.current.error).toBe(cs.errors.sessionExpired);
    });
});
