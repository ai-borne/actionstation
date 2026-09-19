/**
 * Structural test: SEO files use the production domain from domainConfig.ts
 *
 * index.html (canonical, OG, JSON-LD), sitemap.xml and robots.txt must all
 * point at the custom production domain — the SSOT in functions/src/utils/domainConfig.ts.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const ROOT = process.cwd();
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf-8');

const domainConfigSrc = read('functions', 'src', 'utils', 'domainConfig.ts');
const customBlock = /CUSTOM_DOMAINS\s*=\s*\[([\s\S]*?)\]/.exec(domainConfigSrc)?.[1] ?? '';
const PRODUCTION_ORIGIN = /'(https:\/\/[^']+)'/.exec(customBlock)?.[1] ?? '';

const SEO_FILES: readonly (readonly string[])[] = [
    ['index.html'],
    ['public', 'sitemap.xml'],
    ['public', 'robots.txt'],
];

describe('SEO files use the production domain', () => {
    it('domainConfig.ts declares a custom production origin', () => {
        expect(PRODUCTION_ORIGIN).toMatch(/^https:\/\/www\./);
    });

    it.each(SEO_FILES)('%s references only the production origin', (...parts) => {
        const src = read(...parts);
        const origins = src.match(/https:\/\/(?:www\.)?actionstation\.[a-z]+/g) ?? [];
        expect(origins.length).toBeGreaterThan(0);
        for (const origin of origins) {
            expect(origin).toBe(PRODUCTION_ORIGIN);
        }
    });
});
