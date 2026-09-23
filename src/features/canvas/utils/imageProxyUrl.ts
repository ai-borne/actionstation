/**
 * Image Source Mode - Decides how a link-preview image may be rendered.
 * In production: routed through the signed Cloud Function proxy for privacy.
 * In development: original URL directly (emulator has ORB issues).
 */
import { isProxyConfigured } from '@/config/linkPreviewConfig';

/** 'none' = don't render, 'direct' = raw URL, 'proxy' = signed proxy URL */
export type ImageSourceMode = 'none' | 'direct' | 'proxy';

/** Check if running in dev mode (read at call time for testability) */
function isDev(): boolean {
    return import.meta.env.DEV;
}

/** Only allow http: and https: schemes for image URLs */
function isSafeScheme(url: string): boolean {
    try {
        const scheme = new URL(url).protocol;
        return scheme === 'http:' || scheme === 'https:';
    } catch {
        return false;
    }
}

export function getImageSourceMode(rawUrl: string | undefined): ImageSourceMode {
    if (!rawUrl || !isSafeScheme(rawUrl)) return 'none';
    if (isDev() || !isProxyConfigured()) return 'direct';
    return 'proxy';
}
