/**
 * calendarSyncController - Keeps Google Calendar events in step with the cards that own them.
 * Observes the canvas (edits, restores) and the node-deletion signal, asks calendarSyncPolicy
 * what each mutation requires, and executes it through calendarNodeOps. No React, no UI.
 */
import { useCanvasStore, getNodeMap } from '@/features/canvas/stores/canvasStore';
import { onNodesDeleted } from '@/features/canvas/services/nodeDeletionSignal';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { useNetworkStatusStore } from '@/shared/stores/networkStatusStore';
import { useTabRoleStore } from '@/shared/stores/tabRoleStore';
import { toast } from '@/shared/stores/toastStore';
import { logger } from '@/shared/services/logger';
import type { CanvasNode } from '@/features/canvas/types/node';
import { calendarStrings as cs } from '../localization/calendarStrings';
import { CALENDAR_UPDATE_DEBOUNCE_MS, CALENDAR_DELETE_GRACE_MS } from '../config/syncTiming';
import {
    decideCalendarOp, deliveryFor, resolveEventPatch,
    type NodeSnapshot, type SyncedEventField,
} from '../policy/calendarSyncPolicy';
import type { CalendarEventMetadata } from '../types/calendarEvent';
import { pushDelete, pushUpdate } from './calendarNodeOps';
import { createDeleteQueue, type DeleteQueue } from './calendarDeleteQueue';
import { createUpdateScheduler, type UpdateScheduler } from './calendarUpdateScheduler';

interface Tracked {
    readonly snap: NodeSnapshot;
    readonly event: CalendarEventMetadata;
}

const isLeader = (): boolean => useTabRoleStore.getState().isLeader;

function isGoogleReachable(): boolean {
    return useAuthStore.getState().isCalendarConnected && useNetworkStatusStore.getState().isOnline;
}

function track(card: CanvasNode): Tracked | null {
    const { data } = card;
    const event = data.calendarEvent;
    if (!event) return null;
    const { heading = '', output = '', isGenerating = false } = data;
    return { snap: { heading, output, isGenerating }, event };
}

function notifyDeleteFailed(count: number): void {
    toast.error(count === 1 ? cs.errors.deleteFailed : cs.sync.deleteFailedMany(count));
}

function logFailure(err: unknown): void {
    logger.warn('[calendarSync] background sync failed', err);
}

/** The card as it is now; if it was unloaded (workspace switch) meanwhile, as we last saw it. */
function currentOf(nodeId: string, tracking: Map<string, Tracked>): Tracked | null {
    const live = getNodeMap(useCanvasStore.getState().nodes).get(nodeId);
    if (live) return track(live);
    const lastSeen = tracking.get(nodeId) ?? null;
    tracking.delete(nodeId);
    return lastSeen;
}

/** Deliver dirty title/notes: to Google when reachable, otherwise as a pending snapshot for the retry badge. */
async function deliverUpdate(nodeId: string, fields: readonly SyncedEventField[], current: Tracked): Promise<void> {
    const patch = resolveEventPatch(fields, current.snap, current.event);
    if (!patch) return;
    const merged = { ...current.event, ...patch };
    if (deliveryFor(current.event, isGoogleReachable()) === 'local') {
        useCanvasStore.getState().setNodeCalendarEvent(nodeId, { ...merged, status: 'pending' });
        return;
    }
    const outcome = await pushUpdate(nodeId, merged);
    // REAUTH was announced by the ops layer; an already-failed badge needs no second toast.
    if (!outcome.isOk && !outcome.isReauth && current.event.status !== 'failed') toast.error(cs.errors.updateFailed);
}

/** A card came (back) into view carrying a Google id: settle it against the delete queue. */
function settleRestored(queue: DeleteQueue, nodeId: string, event: CalendarEventMetadata): void {
    const op = decideCalendarOp(
        { kind: 'restored', isDeletePending: queue.isPending(event.id), isEventDeleted: queue.wasDeleted(event.id) }, event,
    );
    if (op.kind === 'cancelDelete') queue.cancel(op.eventId);
    if (op.kind === 'resetToPending') {
        useCanvasStore.getState().setNodeCalendarEvent(nodeId, {
            ...event, id: '', status: 'pending', syncedAt: undefined, error: undefined,
        });
    }
}

interface SyncContext {
    readonly tracking: Map<string, Tracked>;
    readonly queue: DeleteQueue;
    readonly scheduler: UpdateScheduler;
}

/** React to the canvas changing: schedule edits, settle restored cards, forget unloaded ones. */
function observe(ctx: SyncContext, nodes: readonly CanvasNode[]): void {
    const seen = new Set<string>();
    const appeared: Array<{ id: string; event: CalendarEventMetadata }> = [];
    for (const card of nodes) {
        const next = track(card);
        if (!next) continue;
        seen.add(card.id);
        const prev = ctx.tracking.get(card.id);
        ctx.tracking.set(card.id, next);
        if (!prev) { appeared.push({ id: card.id, event: next.event }); continue; }
        const op = decideCalendarOp({ kind: 'edited', prev: prev.snap, next: next.snap }, next.event);
        if (op.kind === 'update') ctx.scheduler.schedule(card.id, op.fields);
    }
    // Unloaded cards stay tracked only while an update is still waiting to be sent.
    for (const id of [...ctx.tracking.keys()]) {
        if (!seen.has(id) && !ctx.scheduler.isPending(id)) ctx.tracking.delete(id);
    }
    // Store writes happen after the loop so this observer is never re-entered mid-iteration.
    appeared.forEach(({ id, event }) => settleRestored(ctx.queue, id, event));
}

/** The canvas announced deletions: queue their Google deletes (after the undo window). */
function handleDeleted(ctx: SyncContext, nodes: readonly CanvasNode[]): void {
    const eventIds: string[] = [];
    for (const card of nodes) {
        ctx.scheduler.cancel(card.id);
        ctx.tracking.delete(card.id);
        const op = decideCalendarOp({ kind: 'deleted' }, card.data.calendarEvent);
        if (op.kind === 'delete') eventIds.push(op.eventId);
    }
    // A follower tab's deletion is never persisted to Firestore, so it must not reach Google either.
    if (isLeader()) ctx.queue.schedule(eventIds);
}

/** Start observing. Returns the stop function (unsubscribes and drops all pending work). */
export function startCalendarSync(): () => void {
    const tracking = new Map<string, Tracked>();
    const ctx: SyncContext = {
        tracking,
        queue: createDeleteQueue({ graceMs: CALENDAR_DELETE_GRACE_MS, run: pushDelete, onFailed: notifyDeleteFailed }),
        scheduler: createUpdateScheduler({
            debounceMs: CALENDAR_UPDATE_DEBOUNCE_MS,
            flush: (nodeId, fields) => {
                const current = isLeader() ? currentOf(nodeId, tracking) : null;
                if (current) void deliverUpdate(nodeId, fields, current).catch(logFailure);
            },
        }),
    };
    const handleVisibility = (): void => {
        if (document.visibilityState !== 'hidden') return;
        ctx.scheduler.flushNow();
        void ctx.queue.flushNow().catch(logFailure);
    };

    observe(ctx, useCanvasStore.getState().nodes);
    const unsubscribeStore = useCanvasStore.subscribe((state, prev) => {
        if (state.nodes !== prev.nodes) observe(ctx, state.nodes);
    });
    const unsubscribeDeleted = onNodesDeleted((nodes) => handleDeleted(ctx, nodes));
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
        unsubscribeStore();
        unsubscribeDeleted();
        document.removeEventListener('visibilitychange', handleVisibility);
        ctx.scheduler.dispose();
        ctx.queue.dispose();
        tracking.clear();
    };
}
