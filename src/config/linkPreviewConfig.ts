/**
 * Link Preview Config - Cloud Function URL configuration
 * SSOT for all link preview proxy endpoint URLs
 */

/** Base URL for Cloud Functions (from environment variable) */
const CLOUD_FUNCTIONS_URL = (import.meta.env.VITE_CLOUD_FUNCTIONS_URL ?? '').trim();

/** Endpoint for fetching link metadata via server proxy */
export function getFetchLinkMetaUrl(): string {
    return `${CLOUD_FUNCTIONS_URL}/fetchLinkMeta`;
}

/**
 * Proxied image URL authorized by an HMAC signature from signImageUrls.
 * <img> tags can't send headers, so the signature — never an ID token — rides in the URL.
 */
export function getSignedProxyImageUrl(imageUrl: string, sig: string, exp: number): string {
    const params = new URLSearchParams({ url: imageUrl, sig, exp: String(exp) });
    return `${CLOUD_FUNCTIONS_URL}/proxyImage?${params.toString()}`;
}

/** Check if Cloud Functions URL is configured */
export function isProxyConfigured(): boolean {
    return CLOUD_FUNCTIONS_URL.length > 0;
}
