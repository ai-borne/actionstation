import { describe, it, expect, beforeEach, vi } from 'vitest';

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
import { createEvent, deleteEvent, updateEvent } from '../services/calendarService';
// eslint-disable-next-line import-x/first
import { disconnectGoogleCalendar } from '@/features/auth/services/calendarAuthService';
// eslint-disable-next-line import-x/first
import { toast } from '@/shared/stores/toastStore';
// eslint-disable-next-line import-x/first
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';
// eslint-disable-next-line import-x/first
import { REAUTH_REQUIRED } from '../services/serverCalendarClient';
// eslint-disable-next-line import-x/first
import { calendarStrings as cs } from '../localization/calendarStrings';
// eslint-disable-next-line import-x/first
import { pushCreate, pushUpdate, pushDelete } from '../services/calendarNodeOps';

const draft = { id: 'evt1', type: 'event' as const, title: 'T', date: '2030-01-01T10:00:00Z', notes: 'n' };
const synced = { ...draft, status: 'synced' as const, calendarId: 'primary', syncedAt: 1 };

const nodeEvent = () => useCanvasStore.getState().nodes[0]?.data.calendarEvent;

describe('calendarNodeOps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useCanvasStore.setState({
            nodes: [{
                id: 'n1', workspaceId: 'ws', type: 'idea', data: { heading: 'h' },
                position: { x: 0, y: 0 }, createdAt: new Date(), updatedAt: new Date(),
            }],
            edges: [], selectedNodeIds: new Set(),
        });
    });

    describe('pushUpdate', () => {
        it('stores the returned metadata and reports success', async () => {
            vi.mocked(updateEvent).mockResolvedValue(synced);
            const outcome = await pushUpdate('n1', draft);
            expect(updateEvent).toHaveBeenCalledWith('evt1', 'event', 'T', '2030-01-01T10:00:00Z', undefined, 'n');
            expect(nodeEvent()).toEqual(synced);
            expect(outcome).toEqual({ isOk: true, isReauth: false, message: null });
        });

        it('marks the badge failed and reports the message on error', async () => {
            vi.mocked(updateEvent).mockRejectedValue(new Error('boom'));
            const outcome = await pushUpdate('n1', draft);
            expect(nodeEvent()).toMatchObject({ id: 'evt1', status: 'failed', error: 'boom', title: 'T' });
            expect(outcome).toEqual({ isOk: false, isReauth: false, message: 'boom' });
            expect(disconnectGoogleCalendar).not.toHaveBeenCalled();
        });

        it('uses the localized fallback for non-Error rejections', async () => {
            vi.mocked(updateEvent).mockRejectedValue('nope');
            const outcome = await pushUpdate('n1', draft);
            expect(outcome.message).toBe(cs.errors.updateFailed);
        });

        it('disconnects and toasts once on REAUTH_REQUIRED', async () => {
            vi.mocked(updateEvent).mockRejectedValue(new Error(REAUTH_REQUIRED));
            const outcome = await pushUpdate('n1', draft);
            expect(disconnectGoogleCalendar).toHaveBeenCalledTimes(1);
            expect(toast.error).toHaveBeenCalledWith(cs.errors.sessionExpired);
            expect(outcome).toEqual({ isOk: false, isReauth: true, message: cs.errors.sessionExpired });
            expect(nodeEvent()).toMatchObject({ status: 'failed', error: cs.errors.sessionExpired });
        });
    });

    describe('pushCreate', () => {
        it('stores the created metadata', async () => {
            vi.mocked(createEvent).mockResolvedValue(synced);
            const outcome = await pushCreate('n1', 'event', 'T', '2030-01-01T10:00:00Z', undefined, 'n');
            expect(createEvent).toHaveBeenCalledWith('event', 'T', '2030-01-01T10:00:00Z', undefined, 'n');
            expect(nodeEvent()).toEqual(synced);
            expect(outcome.isOk).toBe(true);
        });

        it('marks the badge failed with an empty id on error', async () => {
            vi.mocked(createEvent).mockRejectedValue(new Error('x'));
            const outcome = await pushCreate('n1', 'event', 'T', '2030-01-01T10:00:00Z');
            expect(nodeEvent()).toMatchObject({ id: '', status: 'failed', error: 'x' });
            expect(outcome.isOk).toBe(false);
        });
    });

    describe('pushDelete', () => {
        it('deletes at Google and reports success', async () => {
            vi.mocked(deleteEvent).mockResolvedValue(undefined);
            expect(await pushDelete('evt1')).toEqual({ isOk: true, isReauth: false, message: null });
            expect(deleteEvent).toHaveBeenCalledWith('evt1');
        });

        it('reports failure without touching any node', async () => {
            vi.mocked(deleteEvent).mockRejectedValue(new Error('gone wrong'));
            const outcome = await pushDelete('evt1');
            expect(outcome).toEqual({ isOk: false, isReauth: false, message: 'gone wrong' });
            expect(toast.error).not.toHaveBeenCalled();
        });

        it('uses the localized fallback for non-Error rejections', async () => {
            vi.mocked(deleteEvent).mockRejectedValue(undefined);
            expect((await pushDelete('evt1')).message).toBe(cs.errors.deleteFailed);
        });

        it('disconnects and toasts once on REAUTH_REQUIRED', async () => {
            vi.mocked(deleteEvent).mockRejectedValue(new Error(REAUTH_REQUIRED));
            const outcome = await pushDelete('evt1');
            expect(disconnectGoogleCalendar).toHaveBeenCalledTimes(1);
            expect(toast.error).toHaveBeenCalledWith(cs.errors.sessionExpired);
            expect(outcome).toEqual({ isOk: false, isReauth: true, message: cs.errors.sessionExpired });
        });
    });
});
