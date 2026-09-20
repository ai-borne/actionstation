/**
 * Link Preview Service - Fetches link metadata securely
 * Uses Cloud Function proxy when configured (production),
 * falls back to direct client-side fetch (development only)
 */
import type { LinkPreviewMetadata } from '../types/node';
import { getAuthToken } from '@/features/auth/services/authTokenService';
import { getAppCheckToken } from '@/shared/utils/appCheckToken';
import { getFetchLinkMetaUrl, isProxyConfigured } from '@/config/linkPreviewConfig';
import { fetchLinkPreviewDirect } from './linkPreviewFallback';

/** Fetch timeout in milliseconds */
const FETCH_TIMEOUT_MS = 10_000;

/** Service interface for dependency inversion (SOLID: D) */
export interface LinkPreviewService {
    fetchLinkPreview: (url: string, signal?: AbortSignal) => Promise<LinkPreviewMetadata>;
    extractDomain: (url: string) => string;
}

/** Dependencies that can be injected for testing */
export interface LinkPreviewDeps {
    getToken: () => Promise<string | null>;
    getAppCheckToken: () => Promise<string | null>;
    getEndpointUrl: () => string;
    checkConfigured: () => boolean;
    directFetch: (url: string, signal?: AbortSignal) => Promise<LinkPreviewMetadata>;
    isDev: boolean;
}

/** Default production dependencies */
const defaultDeps: LinkPreviewDeps = {
    getToken: getAuthToken,
    getAppCheckToken,
    getEndpointUrl: getFetchLinkMetaUrl,
    checkConfigured: isProxyConfigured,
    directFetch: fetchLinkPreviewDirect,
    isDev: import.meta.env.DEV,
};

function proxyFailedMetadata(url: string): LinkPreviewMetadata {
    return {
        url,
        domain: extractDomain(url),
        fetchedAt: Date.now(),
        error: true,
    };
}

/**
 * Extract hostname from a URL string.
 * Returns empty string for invalid URLs.
 */
export function extractDomain(url: string): string {
    try { return new URL(url).hostname; }
    catch { return ''; }
}

/**
 * Fetch link preview metadata.
 * Strategy: proxy (Cloud Function) when configured; direct fetch in dev only.
 */
export async function fetchLinkPreview(
    url: string,
    signal?: AbortSignal,
    deps: LinkPreviewDeps = defaultDeps,
): Promise<LinkPreviewMetadata> {
    if (!deps.checkConfigured()) {
        if (deps.isDev) return await deps.directFetch(url, signal);
        return proxyFailedMetadata(url);
    }

    try {
        const [token, appCheckToken] = await Promise.all([
            deps.getToken(),
            deps.getAppCheckToken(),
        ]);
        if (!token) {
            if (deps.isDev) return await deps.directFetch(url, signal);
            return proxyFailedMetadata(url);
        }

        const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
        const combinedSignal = signal
            ? AbortSignal.any([signal, timeoutSignal])
            : timeoutSignal;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        };
        if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;

        const response = await fetch(deps.getEndpointUrl(), {
            method: 'POST',
            headers,
            body: JSON.stringify({ url }),
            signal: combinedSignal,
        });

        if (!response.ok) {
            if (deps.isDev) return await deps.directFetch(url, signal);
            return proxyFailedMetadata(url);
        }

        const data = await response.json() as Partial<LinkPreviewMetadata>;
        const result: LinkPreviewMetadata = {
            ...data,
            url,
            domain: data.domain ?? extractDomain(url),
            fetchedAt: data.fetchedAt ?? Date.now(),
        };

        if (result.error) {
            if (deps.isDev) return await deps.directFetch(url, signal);
            return proxyFailedMetadata(url);
        }

        return result;
    } catch {
        if (deps.isDev) return await deps.directFetch(url, signal);
        return proxyFailedMetadata(url);
    }
}

/** Exported service object following project DI pattern */
export const linkPreviewService: LinkPreviewService = {
    fetchLinkPreview,
    extractDomain,
};
