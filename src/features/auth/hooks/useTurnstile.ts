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
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/shared/services/logger';

const CLOUD_FUNCTIONS_URL = import.meta.env.VITE_CLOUD_FUNCTIONS_URL;
const VITE_TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

/** Turnstile global API types */
interface TurnstileApi {
    render: (container: string | HTMLElement, options: Record<string, unknown>) => string;
    execute: (widgetId: string) => void;
    reset: (widgetId: string) => void;
    remove: (widgetId: string) => void;
    getResponse: (widgetId: string) => string | undefined;
    ready: (callback: () => void) => void;
}

declare global {
    interface Window {
        turnstile?: TurnstileApi;
    }
}

interface UseTurnstileReturn {
    /** Run challenge and verify. Returns true if verified, false on failure. */
    execute: () => Promise<boolean>;
    isLoading: boolean;
    error: string | null;
}

/** Load the Turnstile script once. Returns a promise that resolves when loaded. */
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
    if (scriptPromise) return scriptPromise;
    if (window.turnstile) {
        scriptPromise = Promise.resolve();
        return scriptPromise;
    }

    scriptPromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Turnstile script'));
        document.head.appendChild(script);
    });

    return scriptPromise;
}

/** Create and mount an off-screen container for the invisible widget. */
function createTurnstileContainer(): HTMLDivElement {
    const div = document.createElement('div');
    div.id = 'turnstile-container';
    div.style.position = 'fixed';
    div.style.bottom = '0';
    div.style.right = '0';
    div.style.opacity = '0';
    div.style.pointerEvents = 'none';
    div.style.width = '0';
    div.style.height = '0';
    div.style.overflow = 'hidden';
    document.body.appendChild(div);
    return div;
}

/**
 * Verify the Turnstile token via the Cloud Function.
 * Returns null on success, or an error message string on failure.
 * Throws on network/timeout errors.
 */
async function verifyTokenWithServer(token: string): Promise<string | null> {
    const response = await fetch(`${CLOUD_FUNCTIONS_URL}/verifyTurnstile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        return data.error ?? 'Challenge verification failed';
    }
    return null;
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

/**
 * Poll Turnstile widget for token (max 10 seconds).
 * Stops immediately when cancelledRef.current is true (component unmounted),
 * preventing setState calls on unmounted components.
 */
function pollForToken(
    turnstile: TurnstileApi,
    widgetId: string,
    cancelledRef: { readonly current: boolean },
): Promise<string | undefined> {
    return new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 40; // 40 × 250 ms = 10 s

        const check = () => {
            if (cancelledRef.current) { resolve(undefined); return; }
            attempts++;
            const token = turnstile.getResponse(widgetId);
            if (token) { resolve(token); return; }
            if (attempts >= maxAttempts) { resolve(undefined); return; }
            setTimeout(check, 250);
        };
        check();
    });
}
