/**
 * useQueueDrainer - Drains offline queue when network reconnects
 * Bridge: connects networkStatusStore with offlineQueueStore
 */
import { useEffect, useRef } from 'react';
import { useNetworkStatusStore } from '@/shared/stores/networkStatusStore';
import { useOfflineQueueStore } from '@/features/workspace/stores/offlineQueueStore';
import { toast } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';

export function useQueueDrainer() {
    const isOnline = useNetworkStatusStore((s) => s.isOnline);
    const pendingCount = useOfflineQueueStore((s) => s.pendingCount);
    const wasOfflineRef = useRef(false);

    useEffect(() => {
        if (!isOnline) {
            wasOfflineRef.current = true;
            return;
        }

        if (wasOfflineRef.current && pendingCount > 0) {
            toast.info(strings.offline.reconnected);

            void useOfflineQueueStore.getState().drainQueue();
        }

        wasOfflineRef.current = false;
    }, [isOnline, pendingCount]);
}
