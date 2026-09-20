/**
 * calendarNodeOps - Push a node's calendar event to Google and reflect the result on the node.
 * The single place that turns a calendarService outcome into store state + REAUTH handling,
 * shared by the per-card sync hook and the background sync controller.
 */
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';
import { createEvent, deleteEvent, updateEvent } from './calendarService';
import { REAUTH_REQUIRED } from './serverCalendarClient';
import { calendarStrings as cs } from '../localization/calendarStrings';
import { disconnectGoogleCalendar } from '@/features/auth/services/calendarAuthService';
import { toast } from '@/shared/stores/toastStore';
import { logger } from '@/shared/services/logger';
import type { CalendarEventMetadata, CalendarEventType } from '../types/calendarEvent';

/** The Google-facing fields of a node's calendar event. */
export type EventDraft = Pick<CalendarEventMetadata, 'id' | 'type' | 'title' | 'date' | 'endDate' | 'notes'>;

export interface SyncOutcome {
    readonly isOk: boolean;
    readonly isReauth: boolean;
    readonly message: string | null;
}

const OK: SyncOutcome = { isOk: true, isReauth: false, message: null };

function errorMessage(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
}

/** REAUTH_REQUIRED means the Google session is gone: disconnect once and tell the user. */
function handleReauth(msg: string): SyncOutcome | null {
    if (msg !== REAUTH_REQUIRED) return null;
    disconnectGoogleCalendar();
    toast.error(cs.errors.sessionExpired);
    return { isOk: false, isReauth: true, message: cs.errors.sessionExpired };
}

/** Failure of a node-bound operation: show the failed badge (retryable) and report the outcome. */
function failNode(msg: string, nodeId: string, base: EventDraft): SyncOutcome {
    const outcome = handleReauth(msg) ?? { isOk: false, isReauth: false, message: msg };
    useCanvasStore.getState().setNodeCalendarEvent(nodeId, {
        ...base, status: 'failed', calendarId: 'primary', error: outcome.message ?? msg,
    });
    return outcome;
}

export async function pushCreate(
    nodeId: string, type: CalendarEventType, title: string, date: string,
    endDate?: string, notes?: string,
): Promise<SyncOutcome> {
    try {
        useCanvasStore.getState().setNodeCalendarEvent(nodeId, await createEvent(type, title, date, endDate, notes));
        return OK;
    } catch (err) {
        logger.warn('[calendarNodeOps] create failed', err);
        return failNode(errorMessage(err, cs.errors.syncFailed), nodeId, { id: '', type, title, date, endDate, notes });
    }
}

export async function pushUpdate(nodeId: string, event: EventDraft): Promise<SyncOutcome> {
    const { id, type, title, date, endDate, notes } = event;
    try {
        useCanvasStore.getState().setNodeCalendarEvent(nodeId, await updateEvent(id, type, title, date, endDate, notes));
        return OK;
    } catch (err) {
        logger.warn('[calendarNodeOps] update failed', err);
        return failNode(errorMessage(err, cs.errors.updateFailed), nodeId, event);
    }
}

/** Delete at Google. The node may already be gone, so nothing on the canvas is touched. */
export async function pushDelete(eventId: string): Promise<SyncOutcome> {
    try {
        await deleteEvent(eventId);
        return OK;
    } catch (err) {
        logger.warn('[calendarNodeOps] delete failed', err);
        const msg = errorMessage(err, cs.errors.deleteFailed);
        return handleReauth(msg) ?? { isOk: false, isReauth: false, message: msg };
    }
}
