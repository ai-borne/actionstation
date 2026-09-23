/**
 * useTurnstile — client-side Cloudflare Turnstile CAPTCHA integration
 * Renders an invisible Turnstile widget, obtains a token, and verifies
 * it via the verifyTurnstile Cloud Function before proceeding with login.
 *
 * Flow:
 *  1. Script loads → turnstile.ready callback fires
 *  2. execute() → invisible challenge → token returned
 *  3. POST token to /verifyTurnstile → 200 = pass, 403 = fail
 *  4. Resolves true → useTurnstileGate marks the login page as verified
 *
 * Core script/widget/verification logic lives in turnstileService.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/shared/services/logger';
import type { TurnstileApi } from '../services/turnstileService';
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
    const unmountedRef = useRef(false);
    // Incremented per execute(); a run whose id is no longer current is stale.
    const runIdRef = useRef(0);

    // Mount a hidden container; clean it up on unmount to prevent DOM leaks.
    // Setup resets unmountedRef so StrictMode's mount → unmount → remount
    // cycle doesn't leave the hook permanently cancelled.
    useEffect(() => {
        unmountedRef.current = false;
        containerRef.current = createTurnstileContainer();
        return () => {
            unmountedRef.current = true; // stop any in-flight poll
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

        const runId = ++runIdRef.current;
        const isStale = () => unmountedRef.current || runId !== runIdRef.current;
        const staleRef = { get current() { return isStale(); } };
        setIsLoading(true);
        setError(null);

        try {
            const turnstile = await renderWidget(siteKey, containerRef.current, widgetIdRef);
            const token = await pollForToken(turnstile, widgetIdRef.current ?? '', staleRef);
            if (isStale()) return false; // unmounted or superseded
            if (!token) throw new Error('Turnstile did not return a token');

            const verifyError = await verifyTokenWithServer(token);
            if (isStale()) return false;
            if (verifyError !== null) {
                setError(verifyError);
                turnstile.reset(widgetIdRef.current ?? '');
                return false;
            }
            return true;
        } catch (err: unknown) {
            if (isStale()) return false;
            const msg = err instanceof Error ? err.message : 'CAPTCHA failed';
            setError(msg);
            logger.error('Turnstile verification failed', err instanceof Error ? err : new Error(msg));
            return false;
        } finally {
            if (!isStale()) setIsLoading(false);
        }
    }, []);

    return { execute, isLoading, error };
}

/** Load the script, replace any previous widget, render + execute a fresh one. */
async function renderWidget(
    siteKey: string,
    container: HTMLDivElement | null,
    widgetIdRef: { current: string | null },
): Promise<TurnstileApi> {
    await loadTurnstileScript();
    const turnstile = window.turnstile;
    if (!turnstile) throw new Error('Turnstile API not available');

    // Remove stale widget before re-rendering to prevent widget accumulation.
    if (widgetIdRef.current !== null) {
        turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
    }

    const widgetId = turnstile.render(
        container ?? '#turnstile-container',
        { sitekey: siteKey, size: 'invisible', execution: 'execute' },
    );
    widgetIdRef.current = widgetId;
    turnstile.execute(widgetId);
    return turnstile;
}
