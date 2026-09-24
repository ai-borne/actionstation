/**
 * B22: Firebase Hosting serves HTML with `max-age=3600` by default, so after a deploy a browser
 * or edge kept showing the previous app shell (and old routes) for up to an hour.
 * The shell must always revalidate; only content-hashed /assets files may be cached long.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface HeaderEntry { source: string; headers: Array<{ key: string; value: string }> }
const config = JSON.parse(readFileSync(resolve(__dirname, '../../firebase.json'), 'utf8')) as {
    hosting: { headers: readonly HeaderEntry[] };
};

const cacheControl = (source: string): string | undefined =>
    config.hosting.headers
        .filter((h) => h.source === source)
        .flatMap((h) => h.headers)
        .find((h) => h.key === 'Cache-Control')?.value;

describe('hosting Cache-Control', () => {
    it('makes every response revalidate by default so the app shell is never stale', () => {
        expect(cacheControl('**')).toBe('no-cache');
    });

    it('lets content-hashed build assets be cached for a year, immutable', () => {
        expect(cacheControl('/assets/**')).toBe('public, max-age=31536000, immutable');
    });

    it('never gives the service worker or HTML a long cache', () => {
        for (const source of ['/sw.js', '/index.html']) {
            const value = cacheControl(source);
            expect(value === undefined || /no-cache|max-age=0/.test(value)).toBe(true);
        }
    });
});
