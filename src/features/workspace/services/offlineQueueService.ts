/**
 * Offline Queue Service - localStorage-backed save queue
 * SOLID SRP: Only manages queue persistence, no network logic
 */
import { getStorageJson, setStorageJson } from '@/shared/utils/storage';
import type { QueuedSaveOperation } from '../types/offlineQueue';

const QUEUE_STORAGE_KEY = 'offline-save-queue';
const MAX_QUEUE_SIZE = 50;

interface OfflineQueueService {
    getQueue(): QueuedSaveOperation[];
    enqueue(op: QueuedSaveOperation): boolean;
    dequeue(operationId: string): void;
    discardWorkspace(workspaceId: string, queuedBefore?: number): void;
    updateRetryCount(opId: string, retryCount: number): void;
    getOldestOperation(): QueuedSaveOperation | null;
    size(): number;
    clear(): void;
}

function getQueue(): QueuedSaveOperation[] {
    return getStorageJson<QueuedSaveOperation[]>(QUEUE_STORAGE_KEY, []);
}

function persistQueue(queue: QueuedSaveOperation[]): boolean {
    return setStorageJson(QUEUE_STORAGE_KEY, queue);
}

function enqueue(op: QueuedSaveOperation): boolean {
    let queue = getQueue();

    // Coalesce: replace existing operation for same workspace (latest state wins)
    queue = queue.filter((existing) => existing.workspaceId !== op.workspaceId);
    queue.push(op);

    // Enforce max size: drop oldest if over limit
    if (queue.length > MAX_QUEUE_SIZE) {
        queue.sort((a, b) => a.queuedAt - b.queuedAt);
        queue = queue.slice(queue.length - MAX_QUEUE_SIZE);
    }

    return persistQueue(queue);
}

function dequeue(operationId: string): void {
    const queue = getQueue().filter((op) => op.id !== operationId);
    persistQueue(queue);
}

/**
 * Drops a workspace's stale queued snapshots, optionally only those queued at or before
 * `queuedBefore` (ms). A snapshot that already failed to sync (retryCount > 0) is kept:
 * it may be the only copy of that content.
 */
function discardWorkspace(workspaceId: string, queuedBefore = Number.POSITIVE_INFINITY): void {
    const queue = getQueue();
    const kept = queue.filter((op) =>
        op.workspaceId !== workspaceId || op.queuedAt > queuedBefore || op.retryCount > 0);
    if (kept.length !== queue.length) persistQueue(kept);
}

function getOldestOperation(): QueuedSaveOperation | null {
    const queue = getQueue();
    if (queue.length === 0) return null;

    return queue.reduce((oldest, current) =>
        current.queuedAt < oldest.queuedAt ? current : oldest
    );
}

function updateRetryCount(opId: string, retryCount: number): void {
    const queue = getQueue();
    const op = queue.find((o) => o.id === opId);
    if (op) {
        op.retryCount = retryCount;
        persistQueue(queue);
    }
}

function size(): number {
    return getQueue().length;
}

function clear(): void {
    persistQueue([]);
}

export const offlineQueueService: OfflineQueueService = {
    getQueue,
    enqueue,
    dequeue,
    discardWorkspace,
    updateRetryCount,
    getOldestOperation,
    size,
    clear,
};
