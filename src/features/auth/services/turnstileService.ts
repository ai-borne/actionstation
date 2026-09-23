/**
 * Turnstile challenge core — script loading, widget lifecycle, and
 * server-side verification, used by the useTurnstile hook.
 */

const CLOUD_FUNCTIONS_URL = import.meta.env.VITE_CLOUD_FUNCTIONS_URL;

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
 * Stops immediately when cancelledRef.current is true (component unmounted or
 * run superseded), preventing stale state updates.
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
