/**
 * Image Source Mode Tests
 * Decides how a link-preview image may be rendered: not at all (unsafe),
 * directly (dev / proxy unconfigured), or through the signed proxy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getImageSourceMode } from '../imageProxyUrl';
import { isProxyConfigured } from '@/config/linkPreviewConfig';

vi.mock('@/config/linkPreviewConfig', () => ({
    isProxyConfigured: vi.fn().mockReturnValue(true),
}));

describe('getImageSourceMode', () => {
    beforeEach(() => {
        vi.stubEnv('DEV', false);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.mocked(isProxyConfigured).mockReturnValue(true);
    });

    it('proxies http(s) images in production', () => {
        expect(getImageSourceMode('https://example.com/image.png')).toBe('proxy');
        expect(getImageSourceMode('http://example.com/image.png')).toBe('proxy');
    });

    it('proxies URLs with query strings and unicode', () => {
        expect(getImageSourceMode('https://example.com/img?id=123&size=large')).toBe('proxy');
        expect(getImageSourceMode('https://example.com/画像.png')).toBe('proxy');
    });

    it.each([undefined, ''])('renders nothing for empty input (%s)', (input) => {
        expect(getImageSourceMode(input)).toBe('none');
    });

    it('renders nothing for javascript: URLs (XSS prevention)', () => {
        expect(getImageSourceMode('javascript:alert(1)')).toBe('none');
    });

    it('renders nothing for data: URLs', () => {
        expect(getImageSourceMode('data:text/html,<script>alert(1)</script>')).toBe('none');
    });

    it('renders nothing for malformed URLs', () => {
        expect(getImageSourceMode('not a url')).toBe('none');
    });

    it('loads directly when the proxy is not configured', () => {
        vi.mocked(isProxyConfigured).mockReturnValue(false);
        expect(getImageSourceMode('https://example.com/img.png')).toBe('direct');
    });

    it('loads directly in dev mode', () => {
        vi.stubEnv('DEV', true);
        expect(getImageSourceMode('https://example.com/img.png')).toBe('direct');
    });
});
