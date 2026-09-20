/**
 * useIdeaCardCalendar - Calendar badge interaction for IdeaCard
 * Handles retry on failed/pending syncs (deletes and edits sync in the background: calendarSyncController).
 * Pending items (no token at creation) trigger re-connect on retry (user gesture).
 */
import { useCallback } from 'react';
import { useCalendarSync } from './useCalendarSync';
import { connectGoogleCalendar } from '@/features/auth/services/calendarAuthService';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { AUTOSAVE_YIELD_MS } from '../config/connectTiming';
import type { CalendarEventMetadata } from '../types/calendarEvent';

interface UseIdeaCardCalendarOptions {
    nodeId: string;
    calendarEvent?: CalendarEventMetadata;
}

export function useIdeaCardCalendar({ nodeId, calendarEvent }: UseIdeaCardCalendarOptions) {
    const { syncCreate, syncUpdate, isLoading } = useCalendarSync(nodeId);

    const handleRetry = useCallback(async () => {
        if (!calendarEvent) return;
        const { id, type, title, date, endDate, notes } = calendarEvent;

        if (!useAuthStore.getState().isCalendarConnected) {
            // Yield to the event loop so any in-flight autosave debounce can
            // flush its Firestore write before the browser navigates away.
            await new Promise<void>((resolve) => setTimeout(resolve, AUTOSAVE_YIELD_MS));
            const ok = connectGoogleCalendar();
            if (!ok) return;
        }

        if (id) {
            await syncUpdate(id, type, title, date, endDate, notes);
        } else {
            await syncCreate(type, title, date, endDate, notes);
        }
    }, [calendarEvent, syncCreate, syncUpdate]);

    return { handleRetry, isLoading };
}
