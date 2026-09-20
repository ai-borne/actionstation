/**
 * Link Preview Proxy Integration Tests
 * Validates the service -> cache -> store flow with mocked Cloud Function
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    fetchLinkPreview,
    type LinkPreviewDeps,
} from '../linkPreviewService';
import { getFromCache, setInCache, clearCache } from '../linkPreviewCache';
import type { LinkPreviewMetadata } from '../../types/node';

/** Create fresh test deps for each test */
function createMockDeps(): LinkPreviewDeps {
    return {
        getToken: vi.fn().mockResolvedValue('mock-firebase-token'),
        getAppCheckToken: vi.fn().mockResolvedValue('mock-app-check-token'),
        getEndpointUrl: () => 'https://test-functions.net/fetchLinkMeta',
        checkConfigured: () => true,
        isDev: true,
        directFetch: vi.fn().mockResolvedValue({
            url: 'https://fallback.com', domain: 'fallback.com',
            fetchedAt: Date.now(), error: true,
        } satisfies LinkPreviewMetadata),
    };
}

describe('linkPreviewProxy integration', () => {
    let mockDeps: LinkPreviewDeps;

    beforeEach(() => {
        clearCache();
        mockDeps = createMockDeps();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fetched metadata can be stored in and retrieved from cache', async () => {
        const serverResponse: LinkPreviewMetadata = {
            url: 'https://example.com',
            title: 'Example Site',
            description: 'An example website',
            image: 'https://example.com/og.png',
            domain: 'example.com',
            fetchedAt: Date.now(),
        };

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(serverResponse),
        }));

        const metadata = await fetchLinkPreview(
            'https://example.com', undefined, mockDeps,
        );
        expect(metadata.title).toBe('Example Site');

        setInCache(metadata.url, metadata);
        const cached = getFromCache('https://example.com');
        expect(cached).not.toBeNull();
        expect(cached?.title).toBe('Example Site');
    });

    it('error metadata is not served from cache (allows retry)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
            new Error('Network error'),
        ));

        const metadata = await fetchLinkPreview(
            'https://fail.com', undefined, mockDeps,
        );
        expect(metadata.error).toBe(true);

        setInCache(metadata.url, metadata);
        const cached = getFromCache('https://fail.com');
        expect(cached).toBeNull(); // Error entries are skipped on read
    });

    it('multiple sequential fetches produce independent results', async () => {
        const makeResponse = (
            url: string, title: string,
        ): LinkPreviewMetadata => ({
            url, title, domain: new URL(url).hostname, fetchedAt: Date.now(),
        });

        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(
                    makeResponse('https://a.com', 'Site A'),
                ),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(
                    makeResponse('https://b.com', 'Site B'),
                ),
            }),
        );

        const resultA = await fetchLinkPreview(
            'https://a.com', undefined, mockDeps,
        );
        const resultB = await fetchLinkPreview(
            'https://b.com', undefined, mockDeps,
        );

        expect(resultA.title).toBe('Site A');
        expect(resultB.title).toBe('Site B');
    });

    it('falls back to directFetch when proxy is not configured', async () => {
        const noProxyDeps = createMockDeps();
        noProxyDeps.checkConfigured = () => false;
        vi.mocked(noProxyDeps.directFetch).mockResolvedValue({
            url: 'https://example.com',
            title: 'Direct Fetch Result',
            domain: 'example.com',
            fetchedAt: Date.now(),
        });

        const result = await fetchLinkPreview(
            'https://example.com', undefined, noProxyDeps,
        );
        expect(result.title).toBe('Direct Fetch Result');
        expect(noProxyDeps.directFetch).toHaveBeenCalled();
    });
});
