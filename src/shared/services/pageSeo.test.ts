import { describe, it, expect, beforeEach } from 'vitest';
import { applyPageSeo } from './pageSeo';

function canonical(): string | null {
    return document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
}
function robots(): string | null {
    return document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
}

describe('applyPageSeo', () => {
    beforeEach(() => {
        document.head.innerHTML = '<link rel="canonical" href="https://www.actionstation.in/">';
        document.title = 'x';
    });

    it('gives each public page its own canonical URL and title', () => {
        applyPageSeo('/terms');
        expect(canonical()).toBe('https://www.actionstation.in/terms');
        expect(document.title).toMatch(/terms/i);
        expect(robots()).toBeNull();
    });

    it('keeps the landing page canonical at the origin root', () => {
        applyPageSeo('/');
        expect(canonical()).toBe('https://www.actionstation.in/');
    });

    it('marks non-public routes noindex and drops the canonical', () => {
        applyPageSeo('/login');
        expect(robots()).toBe('noindex');
        expect(canonical()).toBeNull();
    });

    it('clears noindex when navigating back to a public page', () => {
        applyPageSeo('/login');
        applyPageSeo('/privacy');
        expect(robots()).toBeNull();
        expect(canonical()).toBe('https://www.actionstation.in/privacy');
    });
});
