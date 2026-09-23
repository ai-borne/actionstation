/**
 * useSignedImageUrl - <img> src for a link-preview image.
 * Proxied images get a signed proxyImage URL (no ID token in the URL);
 * returns '' while signing, on failure, or for unsafe URLs.
 */
import { useEffect, useState } from 'react';
import { logger } from '@/shared/services/logger';
import { getImageSourceMode } from '../utils/imageProxyUrl';
import { imageSigner } from '../services/imageSigningService';

export function useSignedImageUrl(rawUrl: string | undefined): string {
    const mode = getImageSourceMode(rawUrl);
    const [signed, setSigned] = useState<{ rawUrl: string; url: string } | null>(null);

    useEffect(() => {
        if (mode !== 'proxy' || !rawUrl) return;
        let isActive = true;
        imageSigner.getSignedUrl(rawUrl)
            .then((url) => {
                if (isActive) setSigned({ rawUrl, url });
            })
            .catch((err: unknown) => {
                logger.warn('[useSignedImageUrl] Image signing failed', err);
            });
        return () => { isActive = false; };
    }, [mode, rawUrl]);

    if (mode === 'none' || !rawUrl) return '';
    if (mode === 'direct') return rawUrl;
    return signed?.rawUrl === rawUrl ? signed.url : '';
}
