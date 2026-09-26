import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQueueDrainer } from '@/app/hooks/useQueueDrainer';
import { useNetworkStatusStore } from '@/shared/stores/networkStatusStore';
import { useOfflineQueueStore } from '@/features/workspace/stores/offlineQueueStore';

describe('useQueueDrainer', () => {
    const drainQueue = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        drainQueue.mockClear();
        useNetworkStatusStore.setState({ isOnline: true });
        useOfflineQueueStore.setState({ pendingCount: 0, drainQueue });
    });

    it('drains the queue when reconnecting with pending items', () => {
        renderHook(() => useQueueDrainer());
        act(() => useNetworkStatusStore.setState({ isOnline: false }));
        act(() => useOfflineQueueStore.setState({ pendingCount: 2 }));
        act(() => useNetworkStatusStore.setState({ isOnline: true }));
        expect(drainQueue).toHaveBeenCalledTimes(1);
    });

    it('does not drain when nothing is pending', () => {
        renderHook(() => useQueueDrainer());
        act(() => useNetworkStatusStore.setState({ isOnline: false }));
        act(() => useNetworkStatusStore.setState({ isOnline: true }));
        expect(drainQueue).not.toHaveBeenCalled();
    });
});
