/**
 * useCalendarNodeSync - Mounts the background Calendar sync for the signed-in session.
 * Card edits update their Google event; deleted cards remove it (see calendarSyncController).
 */
import { useEffect } from 'react';
import { startCalendarSync } from '../services/calendarSyncController';

export function useCalendarNodeSync(): void {
    useEffect(() => startCalendarSync(), []);
}
