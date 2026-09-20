/**
 * Link Preview Service Tests
 * TDD: Validates Cloud Function proxy calls, auth token, fallback, error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    fetchLinkPreview,
    extractDomain,
    type LinkPreviewDeps,
} from '../linkPreviewService';
import type { LinkPreviewMetadata } from '../../types/node';

/** Create fresh test deps for each test */
function createMockDeps(overrides?: Partial<LinkPreviewDeps>): LinkPreviewDeps {
    return {
        getToken: vi.fn().mockResolvedValue('mock-firebase-token'),
        getAppCheckToken: vi.fn().mockResolvedValue('mock-app-check-token'),
        getEndpointUrl: () => 'https://test-functions.net/fetchLinkMeta',
        checkConfigured: () => true,
        isDev: true,
        directFetch: vi.fn().mockResolvedValue({
            url: 'https://fallback.com',
            title: 'Fallback Title',
            domain: 'fallback.com',
            fetchedAt: Date.now(),
        } satisfies LinkPreviewMetadata),
        ...overrides,
    };
}

describe('linkPreviewService', () => {
    let mockDeps: LinkPreviewDeps;

    beforeEach(() => {
        vi.useFakeTimers();
        mockDeps = createMockDeps();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('extractDomain', () => {
        it('extracts domain from https URL', () => {
            expect(extractDomain('https://example.com/path')).toBe('example.com');
        });

        it('extracts domain from http URL', () => {
            expect(extractDomain('http://blog.example.com')).toBe('blog.example.com');
        });

        it('returns empty string for invalid URL', () => {
            expect(extractDomain('not-a-url')).toBe('');
        });
    });

    describe('fetchLinkPreview - proxy mode', () => {
        it('calls Cloud Function with URL and auth token', async () => {
            const metadata = {
                url: 'https://example.com',
                title: 'Example',
                description: 'A site',
                image: 'https://example.com/img.png',
                domain: 'example.com',
                fetchedAt: Date.now(),
            };

            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(metadata),
            }));

            const result = await fetchLinkPreview(
                'https://example.com', undefined, mockDeps,
            );
            expect(result.title).toBe('Example');
            expect(result.description).toBe('A site');
            expect(result.image).toBe('https://example.com/img.png');
            expect(result.error).toBeUndefined();

            expect(fetch).toHaveBeenCalledWith(
                'https://test-functions.net/fetchLinkMeta',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer mock-firebase-token',
                        'Content-Type': 'application/json',
                    }),
                }),
            );
        });

        it('sends URL in request body', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    url: 'https://example.com',
                    domain: 'example.com',
                    fetchedAt: Date.now(),
                }),
            }));

            await fetchLinkPreview('https://example.com', undefined, mockDeps);

            const fetchCall = vi.mocked(fetch).mock.calls[0];
            const body = JSON.parse(fetchCall?.[1]?.body as string) as { url: string };
            expect(body.url).toBe('https://example.com');
        });

        it('includes App Check header when token is available', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    url: 'https://example.com',
                    domain: 'example.com',
                    fetchedAt: Date.now(),
                }),
            }));

            await fetchLinkPreview('https://example.com', undefined, mockDeps);

            expect(fetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-Firebase-AppCheck': 'mock-app-check-token',
                    }),
                }),
            );
        });

        it('does not fall back to directFetch in production on proxy failure', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

            const prodDeps = createMockDeps({ isDev: false });
            const result = await fetchLinkPreview(
                'https://fail.com', undefined, prodDeps,
            );

            expect(prodDeps.directFetch).not.toHaveBeenCalled();
            expect(result.error).toBe(true);
        });

        it('falls back to directFetch on proxy fetch failure', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
                new Error('Network error'),
            ));

            const result = await fetchLinkPreview(
                'https://fail.com', undefined, mockDeps,
            );
            expect(mockDeps.directFetch).toHaveBeenCalledWith(
                'https://fail.com', undefined,
            );
            expect(result.title).toBe('Fallback Title');
        });

        it('falls back to directFetch on non-ok response', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: false,
                status: 429,
            }));

            const result = await fetchLinkPreview(
                'https://limited.com', undefined, mockDeps,
            );
            expect(mockDeps.directFetch).toHaveBeenCalledWith(
                'https://limited.com', undefined,
            );
            expect(result.title).toBe('Fallback Title');
        });

        it('passes AbortSignal to fetch', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    url: 'https://example.com',
                    domain: 'example.com',
                    fetchedAt: Date.now(),
                }),
            });
            vi.stubGlobal('fetch', fetchMock);

            const controller = new AbortController();
            await fetchLinkPreview(
                'https://example.com', controller.signal, mockDeps,
            );

            expect(fetchMock).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    signal: expect.any(AbortSignal) as AbortSignal,
                }),
            );
        });

        it('preserves domain from server response', async () => {
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    url: 'https://example.com',
                    title: 'Test',
                    domain: 'example.com',
                    fetchedAt: Date.now(),
                }),
            }));

            const result = await fetchLinkPreview(
                'https://example.com', undefined, mockDeps,
            );
            expect(result.domain).toBe('example.com');
        });
    });

    describe('fetchLinkPreview - fallback mode', () => {
        it('uses directFetch when proxy is not configured', async () => {
            const deps = createMockDeps({ checkConfigured: () => false });

            const result = await fetchLinkPreview(
                'https://example.com', undefined, deps,
            );
            expect(deps.directFetch).toHaveBeenCalledWith(
                'https://example.com', undefined,
            );
            expect(result.title).toBe('Fallback Title');
        });

        it('uses directFetch when auth token is unavailable', async () => {
            const deps = createMockDeps({
                getToken: vi.fn().mockResolvedValue(null),
            });

            await fetchLinkPreview('https://example.com', undefined, deps);
            expect(deps.directFetch).toHaveBeenCalled();
        });

        it('passes signal to directFetch', async () => {
            const deps = createMockDeps({ checkConfigured: () => false });
            const controller = new AbortController();

            await fetchLinkPreview(
                'https://example.com', controller.signal, deps,
            );
            expect(deps.directFetch).toHaveBeenCalledWith(
                'https://example.com', controller.signal,
            );
        });
    });
});
