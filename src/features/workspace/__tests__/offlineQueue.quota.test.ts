/**
 * Offline Queue Quota Integration Test
 * TDD RED: Verifies toast.warning is shown when localStorage quota exceeded
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useOfflineQueueStore } from '../stores/offlineQueueStore';
import { toast } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';

vi.mock('@/features/workspace/services/workspaceService', () => ({
    saveNodes: vi.fn().mockResolvedValue(undefined),
    saveEdges: vi.fn().mockResolvedValue(undefined),
    updateWorkspaceNodeCount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/stores/saveStatusStore', () => ({
    useSaveStatusStore: {
        getState: () => ({
            setSaving: vi.fn(),
            setSaved: vi.fn(),
            setError: vi.fn(),
            setQueued: vi.fn(),
        }),
    },
}));

vi.mock('@/shared/stores/toastStore', () => ({
    toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/shared/services/sentryService', () => ({
    captureError: vi.fn(),
}));

describe('offlineQueue quota handling', () => {
    const originalSetItem = Storage.prototype.setItem;

    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        useOfflineQueueStore.setState({ pendingCount: 0, isDraining: false });
    });

    afterEach(() => {
        Storage.prototype.setItem = originalSetItem;
    });

    it('shows toast.warning when localStorage quota is exceeded during queueSave', () => {
        Storage.prototype.setItem = vi.fn(() => {
            throw new DOMException('quota exceeded', 'QuotaExceededError');
        });

        useOfflineQueueStore.getState().queueSave('user-1', 'ws-1', [], []);

        expect(toast.warning).toHaveBeenCalledWith(strings.security.storageQuotaExceeded);
    });

    it('does not increment pendingCount when enqueue fails', () => {
        Storage.prototype.setItem = vi.fn(() => {
            throw new DOMException('quota exceeded', 'QuotaExceededError');
        });

        useOfflineQueueStore.getState().queueSave('user-1', 'ws-1', [], []);

        expect(useOfflineQueueStore.getState().pendingCount).toBe(0);
    });
});
