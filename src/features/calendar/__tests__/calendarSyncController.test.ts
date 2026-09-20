import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../services/calendarNodeOps', () => ({
    pushUpdate: vi.fn(),
    pushDelete: vi.fn(),
}));
vi.mock('@/shared/stores/toastStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/shared/stores/toastStore')>()),
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// eslint-disable-next-line import-x/first
import { pushUpdate, pushDelete } from '../services/calendarNodeOps';
// eslint-disable-next-line import-x/first
import { toast } from '@/shared/stores/toastStore';
// eslint-disable-next-line import-x/first
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';
// eslint-disable-next-line import-x/first
import { useAuthStore } from '@/features/auth/stores/authStore';
// eslint-disable-next-line import-x/first
import { useNetworkStatusStore } from '@/shared/stores/networkStatusStore';
// eslint-disable-next-line import-x/first
import { useTabRoleStore } from '@/shared/stores/tabRoleStore';
// eslint-disable-next-line import-x/first
import { startCalendarSync } from '../services/calendarSyncController';
// eslint-disable-next-line import-x/first
import { CALENDAR_UPDATE_DEBOUNCE_MS, CALENDAR_DELETE_GRACE_MS } from '../config/syncTiming';
// eslint-disable-next-line import-x/first
import { calendarStrings as cs } from '../localization/calendarStrings';
// eslint-disable-next-line import-x/first
import type { CanvasNode } from '@/features/canvas/types/node';
// eslint-disable-next-line import-x/first
import type { CalendarEventMetadata } from '../types/calendarEvent';
// eslint-disable-next-line import-x/first
import type { SyncOutcome } from '../services/calendarNodeOps';

const OK: SyncOutcome = { isOk: true, isReauth: false, message: null };
const FAIL: SyncOutcome = { isOk: false, isReauth: false, message: 'x' };

const event = (over: Partial<CalendarEventMetadata> = {}): CalendarEventMetadata => ({
    id: 'evt1', type: 'event', title: 'Call mom', date: '2030-01-01T10:00:00Z',
    notes: 'old notes', status: 'synced', calendarId: 'primary', ...over,
});

const node = (id: string, calendarEvent?: CalendarEventMetadata, data: Partial<CanvasNode['data']> = {}): CanvasNode => ({
    id, workspaceId: 'ws', type: 'idea',
    data: { heading: 'Call mom', output: 'old notes', ...data, ...(calendarEvent ? { calendarEvent } : {}) },
    position: { x: 0, y: 0 }, createdAt: new Date(), updatedAt: new Date(),
});

const store = () => useCanvasStore.getState();
const setNodes = (nodes: CanvasNode[]) => useCanvasStore.setState({ nodes, edges: [], selectedNodeIds: new Set() });
const eventOf = (id: string) => store().nodes.find((n) => n.id === id)?.data.calendarEvent;
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('calendarSyncController', () => {
    let stop: () => void;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        vi.mocked(pushUpdate).mockResolvedValue(OK);
        vi.mocked(pushDelete).mockResolvedValue(OK);
        useAuthStore.setState({ isCalendarConnected: true });
        useNetworkStatusStore.setState({ isOnline: true });
        useTabRoleStore.setState({ isLeader: true });
        setNodes([node('n1', event())]);
        stop = startCalendarSync();
    });
    afterEach(() => { stop(); vi.useRealTimers(); });

    describe('updates', () => {
        it('pushes the new title after the debounce when the heading changes', async () => {
            store().updateNodeHeading('n1', '  Call dad  ');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS - 1);
            expect(pushUpdate).not.toHaveBeenCalled();
            await advance(1);
            expect(pushUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ id: 'evt1', title: 'Call dad', notes: 'old notes' }));
        });

        it('pushes new notes when only the content changes, leaving the title alone', async () => {
            store().updateNodeHeading('n1', 'Raw prompt text');
            store().updateNodeHeading('n1', 'Call mom');
            store().updateNodeOutput('n1', 'fresh notes');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).toHaveBeenCalledTimes(1);
            expect(pushUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ title: 'Call mom', notes: 'fresh notes' }));
        });

        it('coalesces a burst of edits into one call carrying the latest text', async () => {
            store().updateNodeHeading('n1', 'A');
            await advance(500);
            store().updateNodeHeading('n1', 'AB');
            await advance(500);
            store().updateNodeHeading('n1', 'ABC');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).toHaveBeenCalledTimes(1);
            expect(pushUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ title: 'ABC' }));
        });

        it('does nothing when the mapped value already matches Google', async () => {
            store().updateNodeHeading('n1', 'Other');
            store().updateNodeHeading('n1', 'Call mom');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).not.toHaveBeenCalled();
        });

        it('ignores edits on cards without a calendar event', async () => {
            setNodes([node('plain')]);
            store().updateNodeHeading('plain', 'changed');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).not.toHaveBeenCalled();
        });

        it('does not treat loading a workspace as an edit', async () => {
            setNodes([node('n2', event({ id: 'evt2' }), { heading: 'Different', output: 'other' })]);
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).not.toHaveBeenCalled();
        });

        it('ignores the AI confirmation written while the card is generating', async () => {
            setNodes([node('n3')]);
            store().setNodeGenerating('n3', true);
            store().setNodeCalendarEvent('n3', event({ id: 'evt3', notes: 'AI notes' }));
            store().updateNodeOutput('n3', 'Created your event');
            store().setNodeGenerating('n3', false);
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).not.toHaveBeenCalled();
        });

        it('ignores changes made by the sync itself (calendarEvent write-back)', async () => {
            store().setNodeCalendarEvent('n1', event({ syncedAt: 5 }));
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).not.toHaveBeenCalled();
        });

        it('marks the badge pending with the new values when Calendar is not connected', async () => {
            useAuthStore.setState({ isCalendarConnected: false });
            store().updateNodeHeading('n1', 'Call dad');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).not.toHaveBeenCalled();
            expect(eventOf('n1')).toMatchObject({ id: 'evt1', status: 'pending', title: 'Call dad' });
        });

        it('marks the badge pending when offline', async () => {
            useNetworkStatusStore.setState({ isOnline: false });
            store().updateNodeHeading('n1', 'Call dad');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).not.toHaveBeenCalled();
            expect(eventOf('n1')?.status).toBe('pending');
        });

        it('only patches the local snapshot when the event was never created in Google', async () => {
            setNodes([node('n4', event({ id: '', status: 'pending' }))]);
            store().updateNodeHeading('n4', 'New title');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).not.toHaveBeenCalled();
            expect(eventOf('n4')).toMatchObject({ id: '', status: 'pending', title: 'New title' });
        });

        it('a follower tab never writes to Google', async () => {
            useTabRoleStore.setState({ isLeader: false });
            store().updateNodeHeading('n1', 'Call dad');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).not.toHaveBeenCalled();
        });

        it('still delivers an edit when the workspace is switched before the debounce ends', async () => {
            store().updateNodeHeading('n1', 'Call dad');
            setNodes([node('elsewhere')]);
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).toHaveBeenCalledWith('n1', expect.objectContaining({ id: 'evt1', title: 'Call dad' }));
        });

        it('drops the update if the card was deleted meanwhile', async () => {
            store().updateNodeHeading('n1', 'Call dad');
            store().deleteNode('n1');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).not.toHaveBeenCalled();
        });

        it('shows one toast for a failed update', async () => {
            vi.mocked(pushUpdate).mockResolvedValue(FAIL);
            store().updateNodeHeading('n1', 'Call dad');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(toast.error).toHaveBeenCalledTimes(1);
            expect(toast.error).toHaveBeenCalledWith(cs.errors.updateFailed);
        });

        it('does not toast again while the badge already shows failed', async () => {
            setNodes([node('n5', event({ id: 'evt5', status: 'failed', error: 'x' }))]);
            vi.mocked(pushUpdate).mockResolvedValue(FAIL);
            store().updateNodeHeading('n5', 'again');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(pushUpdate).toHaveBeenCalledTimes(1);
            expect(toast.error).not.toHaveBeenCalled();
        });

        it('adds no toast on REAUTH (the ops layer already told the user)', async () => {
            vi.mocked(pushUpdate).mockResolvedValue({ isOk: false, isReauth: true, message: 'expired' });
            store().updateNodeHeading('n1', 'Call dad');
            await advance(CALENDAR_UPDATE_DEBOUNCE_MS);
            expect(toast.error).not.toHaveBeenCalled();
        });
    });

    describe('deletes', () => {
        it('deletes the Google event after the grace window when the card is deleted', async () => {
            store().deleteNode('n1');
            await advance(CALENDAR_DELETE_GRACE_MS - 1);
            expect(pushDelete).not.toHaveBeenCalled();
            await advance(1);
            expect(pushDelete).toHaveBeenCalledWith('evt1');
        });

        it('covers multi-delete', async () => {
            setNodes([node('a', event({ id: 'ea' })), node('b', event({ id: 'eb' })), node('c')]);
            store().deleteNodes(['a', 'b', 'c']);
            await advance(CALENDAR_DELETE_GRACE_MS);
            expect(pushDelete).toHaveBeenCalledTimes(2);
        });

        it('covers user Clear Canvas (deleteAllNodes)', async () => {
            store().deleteAllNodes();
            await advance(CALENDAR_DELETE_GRACE_MS);
            expect(pushDelete).toHaveBeenCalledWith('evt1');
        });

        it('NEVER deletes on workspace unload (clearCanvas) or switch (setNodes)', async () => {
            store().clearCanvas();
            setNodes([node('other', event({ id: 'other-evt' }))]);
            await advance(CALENDAR_DELETE_GRACE_MS * 2);
            expect(pushDelete).not.toHaveBeenCalled();
        });

        it('skips cards that have no Google id yet', async () => {
            setNodes([node('p', event({ id: '', status: 'pending' }))]);
            store().deleteNode('p');
            await advance(CALENDAR_DELETE_GRACE_MS);
            expect(pushDelete).not.toHaveBeenCalled();
        });

        it('Undo inside the grace window keeps the event', async () => {
            const original = store().nodes;
            store().deleteNode('n1');
            await advance(CALENDAR_DELETE_GRACE_MS / 2);
            setNodes(original);
            await advance(CALENDAR_DELETE_GRACE_MS);
            expect(pushDelete).not.toHaveBeenCalled();
            expect(eventOf('n1')).toMatchObject({ id: 'evt1', status: 'synced' });
        });

        it('a delete after an undo is honoured again (redo)', async () => {
            const original = store().nodes;
            store().deleteNode('n1');
            setNodes(original);
            store().deleteNode('n1');
            await advance(CALENDAR_DELETE_GRACE_MS);
            expect(pushDelete).toHaveBeenCalledTimes(1);
        });

        it('Undo AFTER the event was deleted resets the badge to pending so retry recreates it', async () => {
            const original = store().nodes;
            store().deleteNode('n1');
            await advance(CALENDAR_DELETE_GRACE_MS);
            setNodes(original);
            expect(eventOf('n1')).toMatchObject({ id: '', status: 'pending', title: 'Call mom' });
            expect(eventOf('n1')?.error).toBeUndefined();
            expect(eventOf('n1')?.syncedAt).toBeUndefined();
        });

        it('shows one toast for a single failed delete', async () => {
            vi.mocked(pushDelete).mockResolvedValue(FAIL);
            store().deleteNode('n1');
            await advance(CALENDAR_DELETE_GRACE_MS);
            expect(toast.error).toHaveBeenCalledTimes(1);
            expect(toast.error).toHaveBeenCalledWith(cs.errors.deleteFailed);
        });

        it('shows ONE toast with the count when several deletes fail', async () => {
            vi.mocked(pushDelete).mockResolvedValue(FAIL);
            setNodes([node('a', event({ id: 'ea' })), node('b', event({ id: 'eb' }))]);
            store().deleteNodes(['a', 'b']);
            await advance(CALENDAR_DELETE_GRACE_MS);
            expect(toast.error).toHaveBeenCalledTimes(1);
            expect(toast.error).toHaveBeenCalledWith(cs.sync.deleteFailedMany(2));
        });

        it('a follower tab never deletes at Google', async () => {
            useTabRoleStore.setState({ isLeader: false });
            store().deleteNode('n1');
            await advance(CALENDAR_DELETE_GRACE_MS);
            expect(pushDelete).not.toHaveBeenCalled();
        });
    });

    describe('lifecycle', () => {
        it('flushes pending work immediately when the tab is hidden', async () => {
            store().updateNodeHeading('n1', 'Call dad');
            setNodes([...store().nodes, node('z', event({ id: 'ez' }))]);
            store().deleteNode('z');
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
            await advance(0);
            expect(pushUpdate).toHaveBeenCalledTimes(1);
            expect(pushDelete).toHaveBeenCalledWith('ez');
            Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        });

        it('stops observing after stop()', async () => {
            stop();
            store().updateNodeHeading('n1', 'Call dad');
            store().deleteNode('n1');
            await advance(CALENDAR_DELETE_GRACE_MS);
            expect(pushUpdate).not.toHaveBeenCalled();
            expect(pushDelete).not.toHaveBeenCalled();
        });
    });
});
