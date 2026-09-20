/**
 * MultiTabBanner layout — regression guard.
 *
 * `#root` is `display: flex` (row). If the banner is a direct sibling of
 * <Layout> it becomes a side-by-side flex item and squeezes the app into
 * half the screen. It must sit in a column wrapper so it stacks on top.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const APP = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf-8');
const LAYOUT = readFileSync(join(process.cwd(), 'src/app/components/Layout.tsx'), 'utf-8');

describe('MultiTabBanner layout', () => {
    it('is rendered inside a flex-col wrapper together with <Layout>', () => {
        const wrapper = /<div className="flex flex-col w-full min-h-screen">\s*<MultiTabBanner \/>\s*<Layout\b/;
        expect(
            wrapper.test(APP),
            'Wrap <MultiTabBanner /> and <Layout> in a flex-col container so the banner stacks above the app',
        ).toBe(true);
    });

    it('Layout root fills the remaining column height instead of forcing min-h-screen', () => {
        const root = /className="layout-root([^"]*)"/.exec(LAYOUT);
        expect(root).not.toBeNull();
        expect(root![1]).toContain('flex-1');
        expect(root![1]).not.toContain('min-h-screen');
    });
});
