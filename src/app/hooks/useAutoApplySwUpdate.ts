/**
 * useAutoApplySwUpdate - Applies a waiting app update without asking, for
 * signed-out visitors only (landing page, /login). There is no canvas state to
 * lose there, and a stale shell can strand critical fixes (e.g. sign-in).
 * Signed-in users keep the "Update now" prompt so an open canvas never reloads.
 */
import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/features/auth/stores/authStore';
import type { SwRegistrationResult } from '@/shared/hooks/useSwRegistration';
import { logger } from '@/shared/services/logger';

/** If activation fails and the reloaded page still sees a waiting worker, don't reload again this soon. */
export const AUTO_APPLY_COOLDOWN_MS = 60_000;
const LAST_AUTO_APPLY_KEY = 'sw-auto-applied-at';

function isCoolingDown(): boolean {
    try {
        const last = Number(sessionStorage.getItem(LAST_AUTO_APPLY_KEY));
        return last > 0 && Date.now() - last < AUTO_APPLY_COOLDOWN_MS;
    } catch (err: unknown) {
        logger.warn('[sw] sessionStorage unavailable; auto-update loop guard off', err);
        return false;
    }
}

function markApplied(): void {
    try {
        sessionStorage.setItem(LAST_AUTO_APPLY_KEY, String(Date.now()));
    } catch (err: unknown) {
        // The reload still happens; only the loop guard is lost.
        logger.warn('[sw] could not record auto-update time', err);
    }
}

export function useAutoApplySwUpdate({ needRefresh, acceptUpdate }: SwRegistrationResult): void {
    // isLoading covers both the initial auth resolution and an in-progress sign-in
    // popup, where a reload would abort the sign-in.
    const isSignedOut = useAuthStore((s) => !s.isAuthenticated && !s.isLoading);
    const acceptRef = useRef(acceptUpdate);
    acceptRef.current = acceptUpdate;

    useEffect(() => {
        if (!needRefresh || !isSignedOut || isCoolingDown()) return;
        markApplied();
        acceptRef.current();
    }, [needRefresh, isSignedOut]);
}
