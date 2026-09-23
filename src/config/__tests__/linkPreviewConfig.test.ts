/**
 * linkPreviewConfig Tests — proxy endpoint URL construction
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

async function loadConfig(functionsUrl: string) {
    vi.resetModules();
    vi.stubEnv('VITE_CLOUD_FUNCTIONS_URL', functionsUrl);
    return import('../linkPreviewConfig');
}

describe('linkPreviewConfig', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('builds a signed proxyImage URL with the source URL encoded and sig/exp appended', async () => {
        const { getSignedProxyImageUrl } = await loadConfig('https://fn.example.net');
        const out = new URL(getSignedProxyImageUrl('https://x.com/a b.png?s=1&t=2', 'ab12', 1_700_000_000_000));

        expect(out.origin + out.pathname).toBe('https://fn.example.net/proxyImage');
        expect(out.searchParams.get('url')).toBe('https://x.com/a b.png?s=1&t=2');
        expect(out.searchParams.get('sig')).toBe('ab12');
        expect(out.searchParams.get('exp')).toBe('1700000000000');
    });

    it('never includes an auth token in the proxy URL', async () => {
        const { getSignedProxyImageUrl } = await loadConfig('https://fn.example.net');
        const out = new URL(getSignedProxyImageUrl('https://x.com/a.png', 'ab12', 1));
        expect(out.searchParams.has('token')).toBe(false);
    });

    it('builds the fetchLinkMeta endpoint', async () => {
        const { getFetchLinkMetaUrl } = await loadConfig('https://fn.example.net');
        expect(getFetchLinkMetaUrl()).toBe('https://fn.example.net/fetchLinkMeta');
    });

    it('reports whether the proxy is configured', async () => {
        expect((await loadConfig('https://fn.example.net')).isProxyConfigured()).toBe(true);
        expect((await loadConfig('')).isProxyConfigured()).toBe(false);
    });
});
