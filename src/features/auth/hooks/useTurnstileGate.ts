/**
 * useTurnstileGate — verifies Turnstile as soon as the login page mounts.
 *
 * Browsers only allow window.open() inside a click's user-activation window
 * (Safari: ~1 s, Chrome: ~5 s). Running the challenge inside the click handler
 * before signInWithPopup blows that window on Safari; running it after sign-in
 * races the LoginPage unmount. Verifying up front lets the click go straight
 * to signInWithPopup.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/shared/services/logger';
import { useTurnstile } from './useTurnstile';

interface UseTurnstileGateReturn {
    /** True once the challenge has passed server-side verification. */
    isVerified: boolean;
    isLoading: boolean;
    error: string | null;
    /** Re-run the challenge after a failure. */
    retry: () => void;
}

export function useTurnstileGate(): UseTurnstileGateReturn {
    const turnstile = useTurnstile();
    const executeRef = useRef(turnstile.execute);
    executeRef.current = turnstile.execute;

    const [isVerified, setIsVerified] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let isStale = false;
        setIsVerified(false);
        executeRef.current()
            .then((verified) => {
                if (!isStale) setIsVerified(verified);
            })
            .catch((err: unknown) => {
                // execute() reports its own failures; this only guards the contract.
                logger.error('Turnstile gate failed', err instanceof Error ? err : new Error(String(err)));
            });
        return () => { isStale = true; };
    }, [attempt]);

    const retry = useCallback(() => setAttempt((n) => n + 1), []);

    return { isVerified, isLoading: turnstile.isLoading, error: turnstile.error, retry };
}
