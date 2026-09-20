/**
 * PWA Manifest Integration Tests
 * TDD: Validates manifest.json schema for PWA compliance
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface ManifestIcon {
    src: string;
    sizes: string;
    type: string;
    purpose?: string;
}

interface WebAppManifest {
    name: string;
    short_name: string;
    description: string;
    start_url: string;
    display: string;
    background_color: string;
    theme_color: string;
    icons: ManifestIcon[];
}

function loadManifest(): WebAppManifest {
    const manifestPath = resolve(__dirname, '../../../public/manifest.json');
    const raw = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as WebAppManifest;
}

describe('PWA Manifest', () => {
    const manifest = loadManifest();

    it('should have a valid name', () => {
        expect(manifest.name).toBeTruthy();
        expect(typeof manifest.name).toBe('string');
    });

    it('should have a valid short_name', () => {
        expect(manifest.short_name).toBeTruthy();
        expect(manifest.short_name.length).toBeLessThanOrEqual(15);
    });

    it('should have a description', () => {
        expect(manifest.description).toBeTruthy();
    });

    it('should have start_url set to /', () => {
        expect(manifest.start_url).toBe('/');
    });

    it('should have display set to standalone', () => {
        expect(manifest.display).toBe('standalone');
    });

    it('should have a valid theme_color', () => {
        expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it('should have a valid background_color', () => {
        expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it('should have at least a 192x192 and 512x512 icon', () => {
        const sizes = manifest.icons.map((icon) => icon.sizes);
        expect(sizes).toContain('192x192');
        expect(sizes).toContain('512x512');
    });

    it('should have icons with valid type', () => {
        for (const icon of manifest.icons) {
            expect(icon.type).toBe('image/png');
        }
    });

    it('should include a maskable icon for Android', () => {
        const maskable = manifest.icons.find((icon) => icon.purpose === 'maskable');
        expect(maskable).toBeDefined();
    });

    it('should have theme_color matching index.html meta tag', () => {
        const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8');
        const match = /<meta\s+name="theme-color"\s+content="([^"]+)"/.exec(html);
        expect(match).not.toBeNull();
        expect(manifest.theme_color.toLowerCase()).toBe(match?.[1]?.toLowerCase());
    });
});
