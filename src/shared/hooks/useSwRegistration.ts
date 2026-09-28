/**
 * useSwRegistration - Registers Service Worker and tracks update state
 * SOLID SRP: Only manages SW lifecycle and update detection
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { scheduleSwUpdateChecks } from '@/shared/services/swUpdateScheduler';
import { applySwUpdate } from '@/shared/services/swUpdateAccept';

interface SwRegistrationState {
    needRefresh: boolean;
    offlineReady: boolean;
}

interface SwRegistrationActions {
    acceptUpdate: () => void;
    dismissUpdate: () => void;
}

export type SwRegistrationResult = SwRegistrationState & SwRegistrationActions;

export function useSwRegistration(): SwRegistrationResult {
    const [needRefresh, setNeedRefresh] = useState(false);
    const [offlineReady, setOfflineReady] = useState(false);
    const [updateSw, setUpdateSw] = useState<((reload?: boolean) => Promise<void>) | null>(null);
    const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
    // Tracks the waiting worker the user already said "Later" to, so periodic/visibility
    // rechecks don't re-prompt for the same undismissed update — only a genuinely newer one.
    const dismissedWaitingRef = useRef<ServiceWorker | null>(null);

    useEffect(() => {
        let stopChecks: (() => void) | null = null;
        // Dynamic import to avoid bundling SW code in tests / SSR
        void import('virtual:pwa-register').then(({ registerSW }) => {
            const update = registerSW({
                onNeedRefresh: () => {
                    const waiting = registrationRef.current?.waiting ?? null;
                    if (waiting && waiting === dismissedWaitingRef.current) return;
                    setNeedRefresh(true);
                },
                onOfflineReady: () => setOfflineReady(true),
                onRegisteredSW: (_url, registration) => {
                    registrationRef.current = registration ?? null;
                    if (registration) stopChecks = scheduleSwUpdateChecks(registration);
                },
            });
            setUpdateSw(() => update);
        });
        return () => { stopChecks?.(); };
    }, []);

    const acceptUpdate = useCallback(() => {
        applySwUpdate(updateSw, registrationRef.current);
    }, [updateSw]);

    const dismissUpdate = useCallback(() => {
        dismissedWaitingRef.current = registrationRef.current?.waiting ?? null;
        setNeedRefresh(false);
    }, []);

    return { needRefresh, offlineReady, acceptUpdate, dismissUpdate };
}
