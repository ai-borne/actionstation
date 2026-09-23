/**
 * useTurnstile — client-side Cloudflare Turnstile CAPTCHA integration
 * Renders an invisible Turnstile widget, obtains a token, and verifies
 * it via the verifyTurnstile Cloud Function before proceeding with login.
 *
 * Flow:
 *  1. Script loads → turnstile.ready callback fires
 *  2. execute() → invisible challenge → token returned
 *  3. POST token to /verifyTurnstile → 200 = pass, 403 = fail
 *  4. onVerified callback fires → caller proceeds with signInWithGoogle()
 *
 * Core script/widget/verification logic lives in turnstileService.ts,
 * shared with the non-hook redirect-flow verification path.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/shared/services/logger';
import {
    createTurnstileContainer,
    loadTurnstileScript,
    pollForToken,
    verifyTokenWithServer,
} from '../services/turnstileService';

const VITE_TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

interface UseTurnstileReturn {
    /** Run challenge and verify. Returns true if verified, false on failure. */
    execute: () => Promise<boolean>;
    isLoading: boolean;
    error: string | null;
}

export function useTurnstile(): UseTurnstileReturn {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const cancelledRef = useRef(false);

    // Mount a hidden container; clean it up on unmount to prevent DOM leaks.
    useEffect(() => {
        containerRef.current = createTurnstileContainer();
        return () => {
            cancelledRef.current = true; // stop any in-flight poll
            containerRef.current?.remove();
            containerRef.current = null;
        };
    }, []);

    const execute = useCallback(async (): Promise<boolean> => {
        const siteKey = VITE_TURNSTILE_SITE_KEY;
        if (!siteKey) {
            logger.warn('VITE_TURNSTILE_SITE_KEY not configured, skipping CAPTCHA');
            return true;
        }

        setIsLoading(true);
        setError(null);

        try {
            await loadTurnstileScript();

            const turnstile = window.turnstile;
            if (!turnstile) throw new Error('Turnstile API not available');

            // Remove stale widget before re-rendering to prevent widget accumulation.
            if (widgetIdRef.current !== null) {
                turnstile.remove(widgetIdRef.current);
                widgetIdRef.current = null;
            }

            const widgetId = turnstile.render(
                containerRef.current ?? '#turnstile-container',
                { sitekey: siteKey, size: 'invisible', execution: 'execute' },
            );
            widgetIdRef.current = widgetId;
            turnstile.execute(widgetId);

            const token = await pollForToken(turnstile, widgetId, cancelledRef);
            if (cancelledRef.current) return false; // component unmounted
            if (!token) throw new Error('Turnstile did not return a token');

            const verifyError = await verifyTokenWithServer(token);
            if (verifyError !== null) {
                setError(verifyError);
                turnstile.reset(widgetId);
                return false;
            }

            return true;
        } catch (err: unknown) {
            if (cancelledRef.current) return false; // component unmounted
            const msg = err instanceof Error ? err.message : 'CAPTCHA failed';
            setError(msg);
            logger.error('Turnstile verification failed', err instanceof Error ? err : new Error(msg));
            return false;
        } finally {
            if (!cancelledRef.current) setIsLoading(false);
        }
    }, []);

    return { execute, isLoading, error };
}
