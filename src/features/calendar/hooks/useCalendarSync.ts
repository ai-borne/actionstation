/**
 * useCalendarSync - Bridge between calendar ops and React state
 * Owns the loading/error state for per-card create/retry; delivery lives in calendarNodeOps.
 */
import { useState, useCallback } from 'react';
import { pushCreate, pushUpdate, type SyncOutcome } from '../services/calendarNodeOps';
import type { CalendarEventType } from '../types/calendarEvent';

export function useCalendarSync(nodeId: string) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = useCallback(async (operation: () => Promise<SyncOutcome>) => {
        setIsLoading(true);
        setError(null);
        try {
            setError((await operation()).message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const syncCreate = useCallback((
        type: CalendarEventType, title: string, date: string, endDate?: string, notes?: string,
    ) => run(() => pushCreate(nodeId, type, title, date, endDate, notes)), [nodeId, run]);

    const syncUpdate = useCallback((
        eventId: string, type: CalendarEventType, title: string, date: string, endDate?: string, notes?: string,
    ) => run(() => pushUpdate(nodeId, { id: eventId, type, title, date, endDate, notes })), [nodeId, run]);

    return { isLoading, error, syncCreate, syncUpdate };
}
