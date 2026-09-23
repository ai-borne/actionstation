/**
 * Turnstile challenge core — script loading, widget lifecycle, and
 * server-side verification. Shared by:
 *  - useTurnstile (interactive hook, drives the sign-in button's loading/error UI)
 *  - runTurnstileChallenge (one-shot, used to verify redirect-based sign-ins
 *    that never pass through the hook's component lifecycle)
 */
import { logger } from '@/shared/services/logger';

const CLOUD_FUNCTIONS_URL = import.meta.env.VITE_CLOUD_FUNCTIONS_URL;
const VITE_TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

/** Turnstile global API types */
export interface TurnstileApi {
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

/** Load the Turnstile script once. Returns a promise that resolves when loaded. */
let scriptPromise: Promise<void> | null = null;

export function loadTurnstileScript(): Promise<void> {
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

/**
 * Create and mount a container for the invisible widget.
 *
 * Turnstile sizes its own iframe to 0 when no interaction is needed and only
 * grows it when it must escalate to an interactive challenge (this happens
 * more often on Safari, where ITP blocks the cross-site clearance cookie
 * Turnstile relies on to pass silently). The container must stay visible and
 * clickable so that escalation can actually be seen and solved — `opacity: 0`
 * / `pointer-events: none` / a zero-size box would make an escalated
 * challenge permanently unsolvable and the poll below would just time out.
 */
export function createTurnstileContainer(): HTMLDivElement {
    const div = document.createElement('div');
    div.id = 'turnstile-container';
    div.style.position = 'fixed';
    div.style.bottom = 'var(--space-md)';
    div.style.right = 'var(--space-md)';
    div.style.zIndex = '9999';
    document.body.appendChild(div);
    return div;
}

/**
 * Verify the Turnstile token via the Cloud Function.
 * Returns null on success, or an error message string on failure.
 * Throws on network/timeout errors.
 */
export async function verifyTokenWithServer(token: string): Promise<string | null> {
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

/**
 * Poll Turnstile widget for token (max 10 seconds).
 * Stops immediately when cancelledRef.current is true (component unmounted),
 * preventing setState calls on unmounted components.
 */
export function pollForToken(
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

/**
 * Run a full one-shot Turnstile challenge + server verification, independent
 * of any React component lifecycle. Never throws — returns false on any
 * failure (missing API, timeout, network error, server rejection).
 *
 * Used to enforce CAPTCHA on redirect-based sign-ins (e.g. Safari), where
 * the page has already navigated away and back by the time verification
 * needs to run, so there is no mounted LoginPage/useTurnstile instance left.
 */
export async function runTurnstileChallenge(): Promise<boolean> {
    const siteKey = VITE_TURNSTILE_SITE_KEY;
    if (!siteKey) {
        logger.warn('VITE_TURNSTILE_SITE_KEY not configured, skipping CAPTCHA');
        return true;
    }

    const container = createTurnstileContainer();
    const cancelledRef = { current: false };

    try {
        await loadTurnstileScript();

        const turnstile = window.turnstile;
        if (!turnstile) throw new Error('Turnstile API not available');

        const widgetId = turnstile.render(container, {
            sitekey: siteKey,
            size: 'invisible',
            execution: 'execute',
        });
        turnstile.execute(widgetId);

        const token = await pollForToken(turnstile, widgetId, cancelledRef);
        if (!token) return false;

        const verifyError = await verifyTokenWithServer(token);
        return verifyError === null;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'CAPTCHA failed';
        logger.error('Turnstile verification failed', err instanceof Error ? err : new Error(msg));
        return false;
    } finally {
        container.remove();
    }
}
