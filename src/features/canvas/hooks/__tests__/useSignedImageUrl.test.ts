/**
 * useSignedImageUrl Tests
 * Resolves the <img> src for a link-preview image without ever putting an
 * ID token in the URL.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSignedImageUrl } from '../useSignedImageUrl';
import { getImageSourceMode } from '../../utils/imageProxyUrl';
import { imageSigner } from '../../services/imageSigningService';

vi.mock('../../utils/imageProxyUrl', () => ({
    getImageSourceMode: vi.fn(),
}));

vi.mock('../../services/imageSigningService', () => ({
    imageSigner: { getSignedUrl: vi.fn() },
}));

const RAW = 'https://example.com/og.jpg';
const SIGNED = 'https://fn.test/proxyImage?url=x&sig=s&exp=1';

describe('useSignedImageUrl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getImageSourceMode).mockReturnValue('proxy');
        vi.mocked(imageSigner.getSignedUrl).mockResolvedValue(SIGNED);
    });

    it('returns empty until signed, then the signed proxy URL', async () => {
        const { result } = renderHook(() => useSignedImageUrl(RAW));
        expect(result.current).toBe('');
        await waitFor(() => expect(result.current).toBe(SIGNED));
        expect(imageSigner.getSignedUrl).toHaveBeenCalledWith(RAW);
    });

    it('returns the raw URL directly in direct mode, without signing', () => {
        vi.mocked(getImageSourceMode).mockReturnValue('direct');
        const { result } = renderHook(() => useSignedImageUrl(RAW));
        expect(result.current).toBe(RAW);
        expect(imageSigner.getSignedUrl).not.toHaveBeenCalled();
    });

    it('returns empty for unsafe URLs, without signing', () => {
        vi.mocked(getImageSourceMode).mockReturnValue('none');
        const { result } = renderHook(() => useSignedImageUrl('javascript:alert(1)'));
        expect(result.current).toBe('');
        expect(imageSigner.getSignedUrl).not.toHaveBeenCalled();
    });

    it('stays empty when signing fails (image is simply not shown)', async () => {
        vi.mocked(imageSigner.getSignedUrl).mockRejectedValue(new Error('denied'));
        const { result } = renderHook(() => useSignedImageUrl(RAW));
        await waitFor(() => expect(imageSigner.getSignedUrl).toHaveBeenCalled());
        await Promise.resolve();
        expect(result.current).toBe('');
    });

    it('does not show a stale signed URL after the source URL changes', async () => {
        const { result, rerender } = renderHook(({ url }) => useSignedImageUrl(url), { initialProps: { url: RAW } });
        await waitFor(() => expect(result.current).toBe(SIGNED));

        vi.mocked(imageSigner.getSignedUrl).mockReturnValue(new Promise(() => undefined));
        rerender({ url: 'https://example.com/other.jpg' });

        expect(result.current).toBe('');
    });
});
