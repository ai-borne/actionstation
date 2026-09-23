/**
 * Structural test: the PWA service worker must never serve the SPA shell for
 * Firebase Hosting's reserved /__/ paths.
 *
 * authDomain is the app's own origin (see .env.example), so Firebase's auth
 * helper pages (/__/auth/handler — the sign-in popup/redirect target, and
 * /__/auth/iframe — the cross-tab relay) are same-origin navigations. Workbox's
 * default navigateFallback answers every navigation with the precached
 * index.html, which silently replaces those helpers with the app itself and
 * breaks Google sign-in on every browser.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const viteConfig = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf-8');

function parseDenylist(src: string): readonly RegExp[] {
    const body = /navigateFallbackDenylist\s*:\s*\[([\s\S]*?)\]\s*,/.exec(src)?.[1] ?? '';
    const literals = body.match(/\/(?:\\.|[^/\n])+\/[gimsuy]*/g) ?? [];
    return literals.map((lit) => {
        const lastSlash = lit.lastIndexOf('/');
        return new RegExp(lit.slice(1, lastSlash), lit.slice(lastSlash + 1));
    });
}

const denylist = parseDenylist(viteConfig);
const isDenied = (path: string): boolean => denylist.some((re) => re.test(path));

describe('Service worker navigation fallback excludes Firebase reserved paths', () => {
    it('declares a navigateFallbackDenylist in the VitePWA workbox config', () => {
        expect(denylist.length).toBeGreaterThan(0);
    });

    it.each([
        '/__/auth/handler',
        '/__/auth/iframe',
        '/__/auth/handler?apiKey=x&authType=signInViaPopup',
        '/__/firebase/init.json',
    ])('does not serve index.html for %s', (path) => {
        expect(isDenied(path)).toBe(true);
    });

    it.each(['/', '/login', '/workspace/abc', '/terms', '/view/snap-1'])(
        'still serves the SPA shell for app route %s',
        (path) => {
            expect(isDenied(path)).toBe(false);
        },
    );
});
