/**
 * Offline Queue Store - Reactive state for offline save queue
 * SOLID SRP: Bridges offlineQueueService with UI reactivity
 * Attempts Background Sync when available, falls back to manual drain.
 */
import { create } from 'zustand';
import { offlineQueueService } from '../services/offlineQueueService';
import { serializeNodes, deserializeNodes } from '../services/nodeSerializer';
import { useWorkspaceStore } from './workspaceStore';
import { saveNodes, saveEdges, updateWorkspaceNodeCount } from '../services/workspaceService';
import { useSaveStatusStore } from '@/shared/stores/saveStatusStore';
import { toast } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';
import { captureError } from '@/shared/services/sentryService';
import type { CanvasNode } from '@/features/canvas/types/node';
import type { CanvasEdge } from '@/features/canvas/types/edge';

const MAX_DRAIN_RETRIES = 3;
/** Minimum ms between successive flush operations to prevent Firestore write spikes on reconnect. */
const DRAIN_RATE_LIMIT_MS = 500;

interface OfflineQueueState {
    pendingCount: number;
    isDraining: boolean;
}

interface OfflineQueueActions {
    queueSave: (userId: string, workspaceId: string, nodes: CanvasNode[], edges: CanvasEdge[]) => void;
    drainQueue: () => Promise<void>;
    discardWorkspace: (workspaceId: string, queuedBefore?: number) => void;
    refreshCount: () => void;
}

type OfflineQueueStore = OfflineQueueState & OfflineQueueActions;

export const useOfflineQueueStore = create<OfflineQueueStore>()((set) => ({
    pendingCount: offlineQueueService.size(),
    isDraining: false,

    queueSave: (userId, workspaceId, nodes, edges) => {
        const op = {
            id: `save-${workspaceId}-${Date.now()}`,
            userId,
            workspaceId,
            nodes: serializeNodes(nodes),
            edges,
            queuedAt: Date.now(),
            retryCount: 0,
        };
        const queued = offlineQueueService.enqueue(op);
        if (!queued) {
            toast.warning(strings.security.storageQuotaExceeded);
        }
        set({ pendingCount: offlineQueueService.size() });
    },

    drainQueue: async () => {
        const ops = offlineQueueService.getQueue();
        if (ops.length === 0) {
            return;
        }

        set({ isDraining: true });
        const { setSaving, setSaved, setError } = useSaveStatusStore.getState();

        // A snapshot of a workspace that was deleted meanwhile would recreate its nodes as orphans.
        // Only prune once the workspace list is loaded; never guess from an empty list. A snapshot
        // that already failed to sync (retryCount > 0) is left untouched: it may be the only copy.
        const knownIds = new Set(useWorkspaceStore.getState().workspaces.map((ws) => ws.id));
        for (const op of ops) {
            if (knownIds.size > 0 && !knownIds.has(op.workspaceId)) {
                if (op.retryCount === 0) offlineQueueService.dequeue(op.id);
                continue;
            }
            setSaving();
            try {
                const nodes = deserializeNodes(op.nodes);
                await Promise.all([
                    saveNodes(op.userId, op.workspaceId, nodes),
                    saveEdges(op.userId, op.workspaceId, op.edges),
                    updateWorkspaceNodeCount(op.userId, op.workspaceId, nodes.length),
                ]);
                offlineQueueService.dequeue(op.id);
                setSaved();
            } catch (error) {
                const newRetryCount = op.retryCount + 1;
                if (newRetryCount >= MAX_DRAIN_RETRIES) {
                    offlineQueueService.dequeue(op.id);
                    captureError(new Error(strings.offline.syncFailed), {
                        opId: op.id, workspaceId: op.workspaceId, retries: newRetryCount,
                    });
                } else {
                    offlineQueueService.updateRetryCount(op.id, newRetryCount);
                }
                const message = error instanceof Error ? error.message : strings.offline.syncFailed;
                setError(message);
                toast.error(strings.offline.syncFailed);
            }
            // Rate-limit flush to avoid Firestore write spikes on reconnect
            await new Promise<void>((resolve) => setTimeout(resolve, DRAIN_RATE_LIMIT_MS));
        }

        set({ pendingCount: offlineQueueService.size(), isDraining: false });
    },

    refreshCount: () => {
        set({ pendingCount: offlineQueueService.size() });
    },

    // A queued snapshot is stale once a newer save succeeded or its workspace is gone.
    discardWorkspace: (workspaceId, queuedBefore) => {
        offlineQueueService.discardWorkspace(workspaceId, queuedBefore);
        set({ pendingCount: offlineQueueService.size() });
    },
}));
