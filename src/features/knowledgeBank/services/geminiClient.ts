/**
 * Gemini Client — SSOT for all Gemini API communication
 * Routes through Cloud Function proxy when configured (production),
 * falls back to direct API key in development only.
 */
import { getAuthToken } from '@/features/auth/services/authTokenService';
import { getAppCheckToken } from '@/shared/utils/appCheckToken';

// ── URL Configuration ───────────────────────────────────

const DIRECT_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Read Cloud Functions URL at call time (testable) */
function getCloudFunctionsUrl(): string {
    return (import.meta.env.VITE_CLOUD_FUNCTIONS_URL ?? '').trim();
}

/** Read direct API key at call time (testable) */
function getDirectApiKey(): string {
    return import.meta.env.VITE_GEMINI_API_KEY ?? '';
}

/** Check if the Cloud Function proxy is configured */
export function isProxyConfigured(): boolean {
    return getCloudFunctionsUrl().length > 0;
}

/** Check if any Gemini endpoint is available (proxy or direct key) */
export function isGeminiAvailable(): boolean {
    return isProxyConfigured() || Boolean(getDirectApiKey());
}

// ── Response Types ──────────────────────────────────────

/** Standard Gemini API response shape */
export interface GeminiResponse {
    candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
    }>;
    error?: { message: string; code: number };
}

/** Result of a callGemini invocation */
export interface GeminiCallResult {
    ok: boolean;
    status: number;
    data: GeminiResponse | null;
}

/** Request body accepted by the Gemini API / proxy */
export interface GeminiRequestBody {
    contents: Array<{ parts: Array<Record<string, unknown>> }>;
    generationConfig?: {
        temperature?: number;
        maxOutputTokens?: number;
    };
    /** System-level instructions (Gemini API uses snake_case: system_instruction) */
    systemInstruction?: { parts: Array<{ text: string }> };
}

// ── Serialization ────────────────────────────────────────

/** Serialize request body, mapping camelCase systemInstruction → snake_case system_instruction */
function serializeBody(body: GeminiRequestBody): string {
    const { systemInstruction, ...rest } = body;
    if (!systemInstruction) return JSON.stringify(rest);
    return JSON.stringify({ ...rest, system_instruction: systemInstruction });
}

// ── Timeout ──────────────────────────────────────────────

// Must exceed GEMINI_FETCH_TIMEOUT_MS (30s) in functions/src/utils/securityConstants.ts
export const CLIENT_TIMEOUT_MS = 35_000;

// ── Core Call ────────────────────────────────────────────

/** Direct API key fallback is development-only — production must use geminiProxy */
function canUseDirectKeyFallback(): boolean {
    return import.meta.env.DEV && Boolean(getDirectApiKey());
}

/**
 * Call the Gemini API — proxy preferred, direct fallback.
 * Falls back to direct key when the proxy is unreachable (network error)
 * OR returns a transient HTTP error (401/502/503/504).
 * Never throws; returns { ok, status, data }.
 */
export async function callGemini(body: GeminiRequestBody): Promise<GeminiCallResult> {
    try {
        if (isProxyConfigured()) {
            try {
                const result = await callViaProxy(body);
                if (!result.ok && canUseDirectKeyFallback()) {
                    return await callDirect(body);
                }
                return result;
            } catch {
                if (canUseDirectKeyFallback()) {
                    return await callDirect(body);
                }
                return { ok: false, status: 0, data: null };
            }
        }
        if (canUseDirectKeyFallback()) {
            return await callDirect(body);
        }
        return { ok: false, status: 0, data: null };
    } catch {
        return { ok: false, status: 0, data: null };
    }
}

/** Call via Cloud Function proxy (production path) */
async function callViaProxy(body: GeminiRequestBody): Promise<GeminiCallResult> {
    const [token, appCheckToken] = await Promise.all([getAuthToken(), getAppCheckToken()]);
    if (!token) return { ok: false, status: 401, data: null };

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
    if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;

    const url = `${getCloudFunctionsUrl()}/geminiProxy`;
    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: serializeBody(body),
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });

    const data = await response.json() as GeminiResponse;
    return { ok: response.ok, status: response.status, data };
}

/** Call Gemini API directly with API key (development fallback) */
async function callDirect(body: GeminiRequestBody): Promise<GeminiCallResult> {
    const url = `${DIRECT_API_BASE}/gemini-3.1-flash-lite-preview:generateContent?key=${getDirectApiKey()}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serializeBody(body),
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });

    const data = await response.json() as GeminiResponse;
    return { ok: response.ok, status: response.status, data };
}

// ── Response Helpers ────────────────────────────────────

/** Extract the first text result from a Gemini response */
export function extractGeminiText(data: GeminiResponse | null): string | null {
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const text = raw?.trim();
    return (text != null && text.length > 0) ? text : null;
}
