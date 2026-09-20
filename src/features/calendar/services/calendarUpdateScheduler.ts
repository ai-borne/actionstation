/**
 * calendarUpdateScheduler - Per-node debounce for event updates.
 * Collects which event fields went dirty while the user keeps typing, then hands them to
 * `flush` once after the quiet period.
 */
import type { SyncedEventField } from '../policy/calendarSyncPolicy';

interface UpdateSchedulerDeps {
    readonly debounceMs: number;
    readonly flush: (nodeId: string, fields: readonly SyncedEventField[]) => void;
}

export interface UpdateScheduler {
    schedule: (nodeId: string, fields: readonly SyncedEventField[]) => void;
    cancel: (nodeId: string) => void;
    isPending: (nodeId: string) => boolean;
    flushNow: () => void;
    dispose: () => void;
}

interface Pending {
    readonly fields: Set<SyncedEventField>;
    timer: ReturnType<typeof setTimeout>;
}

export function createUpdateScheduler(deps: UpdateSchedulerDeps): UpdateScheduler {
    const pending = new Map<string, Pending>();

    function fire(nodeId: string): void {
        const entry = pending.get(nodeId);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(nodeId);
        deps.flush(nodeId, [...entry.fields]);
    }

    function schedule(nodeId: string, fields: readonly SyncedEventField[]): void {
        const existing = pending.get(nodeId);
        if (existing) clearTimeout(existing.timer);
        const merged = existing?.fields ?? new Set<SyncedEventField>();
        fields.forEach((f) => merged.add(f));
        pending.set(nodeId, { fields: merged, timer: setTimeout(() => fire(nodeId), deps.debounceMs) });
    }

    function cancel(nodeId: string): void {
        const entry = pending.get(nodeId);
        if (entry) clearTimeout(entry.timer);
        pending.delete(nodeId);
    }

    return {
        schedule,
        cancel,
        isPending: (nodeId) => pending.has(nodeId),
        flushNow: () => { [...pending.keys()].forEach(fire); },
        dispose: () => { [...pending.keys()].forEach(cancel); },
    };
}
