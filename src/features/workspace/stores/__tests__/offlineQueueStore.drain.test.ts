/**
 * Offline Queue Drain Tests
 * TDD RED: Iterative drain, per-op resilience, dead-letter protection
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useOfflineQueueStore } from '../offlineQueueStore';
import { offlineQueueService } from '../../services/offlineQueueService';

const mockSaveNodes = vi.fn().mockResolvedValue(undefined);
const mockSaveEdges = vi.fn().mockResolvedValue(undefined);
const mockUpdateNodeCount = vi.fn().mockResolvedValue(undefined);

vi.mock('@/features/workspace/services/workspaceService', () => ({
    saveNodes: (...args: unknown[]) => mockSaveNodes(...args),
    saveEdges: (...args: unknown[]) => mockSaveEdges(...args),
    updateWorkspaceNodeCount: (...args: unknown[]) => mockUpdateNodeCount(...args),
}));

const mockSetSaving = vi.fn();
const mockSetSaved = vi.fn();
const mockSetError = vi.fn();

vi.mock('@/shared/stores/saveStatusStore', () => ({
    useSaveStatusStore: {
        getState: () => ({
            setSaving: mockSetSaving,
            setSaved: mockSetSaved,
            setError: mockSetError,
        }),
    },
}));

vi.mock('@/shared/stores/toastStore', () => ({
    toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

const mockCaptureError = vi.fn();
vi.mock('@/shared/services/sentryService', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

function makeOp(id: string, workspaceId: string) {
    return {
        id,
        userId: 'user-1',
        workspaceId,
        nodes: [],
        edges: [],
        queuedAt: Date.now(),
        retryCount: 0,
    };
}

describe('offlineQueueStore drainQueue', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        useOfflineQueueStore.setState({ pendingCount: 0, isDraining: false });
    });

    it('continues draining after a single op failure (per-op resilience)', async () => {
        offlineQueueService.enqueue(makeOp('op-1', 'ws-1'));
        offlineQueueService.enqueue(makeOp('op-2', 'ws-2'));
        offlineQueueService.enqueue(makeOp('op-3', 'ws-3'));

        let callCount = 0;
        mockSaveNodes.mockImplementation(() => {
            callCount++;
            if (callCount === 2) return Promise.reject(new Error('network error'));
            return Promise.resolve(undefined);
        });

        await useOfflineQueueStore.getState().drainQueue();

        const remaining = offlineQueueService.getQueue();
        const remainingIds = remaining.map((op) => op.id);
        expect(remainingIds).toContain('op-2');
        expect(remainingIds).not.toContain('op-1');
        expect(remainingIds).not.toContain('op-3');
        expect(mockSetSaved).toHaveBeenCalledTimes(2);
    });

    it('does not stack overflow with 50 operations', async () => {
        // Use fake timers so DRAIN_RATE_LIMIT_MS delays (500ms × 50 = 25s) don't
        // block the test runner. We advance the clock in one step to flush all ops.
        vi.useFakeTimers();
        try {
            for (let i = 0; i < 50; i++) {
                offlineQueueService.enqueue(makeOp(`op-${i}`, `ws-${i}`));
            }

            const drainPromise = useOfflineQueueStore.getState().drainQueue();
            // 50 ops × 500ms rate-limit = 25 000ms; advance past that
            await vi.advanceTimersByTimeAsync(30_000);
            await drainPromise;
        } finally {
            vi.useRealTimers();
        }

        expect(offlineQueueService.size()).toBe(0);
    });

    it('removes op after MAX_DRAIN_RETRIES failures and calls captureError', async () => {
        offlineQueueService.enqueue(makeOp('dead-op', 'ws-dead'));
        mockSaveNodes.mockRejectedValue(new Error('permanent failure'));

        await useOfflineQueueStore.getState().drainQueue();
        await useOfflineQueueStore.getState().drainQueue();
        await useOfflineQueueStore.getState().drainQueue();

        expect(offlineQueueService.size()).toBe(0);
        expect(mockCaptureError).toHaveBeenCalled();
        const captureCall = mockCaptureError.mock.calls.find(
            (call) => call[1]?.opId === 'dead-op'
        );
        expect(captureCall).toBeDefined();
        expect(captureCall![1].retries).toBe(3);
    });
});
