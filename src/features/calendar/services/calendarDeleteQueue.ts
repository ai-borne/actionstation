/**
 * calendarDeleteQueue - Grace-period queue for Google event deletes.
 * A removed card's event is deleted only after the undo window closes; restoring the card in
 * time cancels it. Ids that were really deleted are remembered so a LATER restore (Ctrl+Z after
 * the window) can be detected and the stale badge reset.
 */
import type { SyncOutcome } from './calendarNodeOps';

interface DeleteQueueDeps {
    readonly graceMs: number;
    readonly run: (eventId: string) => Promise<SyncOutcome>;
    /** Called once per batch with the number of failed deletes (never after a REAUTH stop). */
    readonly onFailed: (count: number) => void;
}

export interface DeleteQueue {
    schedule: (eventIds: readonly string[]) => void;
    cancel: (eventId: string) => boolean;
    isPending: (eventId: string) => boolean;
    wasDeleted: (eventId: string) => boolean;
    flushNow: () => Promise<void>;
    dispose: () => void;
}

interface Batch {
    readonly ids: Set<string>;
    timer: ReturnType<typeof setTimeout> | null;
}

export function createDeleteQueue(deps: DeleteQueueDeps): DeleteQueue {
    const batches = new Set<Batch>();
    const deletedIds = new Set<string>();

    async function execute(batch: Batch): Promise<void> {
        if (batch.timer) clearTimeout(batch.timer);
        batches.delete(batch);
        let failures = 0;
        for (const id of batch.ids) {
            deletedIds.add(id);
            const outcome = await deps.run(id);
            if (outcome.isOk) continue;
            deletedIds.delete(id);
            if (outcome.isReauth) return; // session is gone: the user was told once, stop here
            failures += 1;
        }
        if (failures > 0) deps.onFailed(failures);
    }

    function schedule(eventIds: readonly string[]): void {
        if (eventIds.length === 0) return;
        const batch: Batch = { ids: new Set(eventIds), timer: null };
        batch.timer = setTimeout(() => { void execute(batch); }, deps.graceMs);
        batches.add(batch);
    }

    function cancel(eventId: string): boolean {
        for (const batch of batches) {
            if (!batch.ids.delete(eventId)) continue;
            if (batch.ids.size === 0) {
                if (batch.timer) clearTimeout(batch.timer);
                batches.delete(batch);
            }
            return true;
        }
        return false;
    }

    return {
        schedule,
        cancel,
        isPending: (eventId) => [...batches].some((b) => b.ids.has(eventId)),
        wasDeleted: (eventId) => deletedIds.has(eventId),
        flushNow: async () => { for (const batch of [...batches]) await execute(batch); },
        dispose: () => {
            for (const batch of batches) if (batch.timer) clearTimeout(batch.timer);
            batches.clear();
        },
    };
}
