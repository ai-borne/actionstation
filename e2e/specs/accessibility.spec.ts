import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app';

interface AxeViolation { readonly id: string; readonly impact: string | null; readonly nodes: ReadonlyArray<{ readonly target: unknown }> }
const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function scan(page: Page): Promise<readonly AxeViolation[]> {
    await page.evaluate(AXE_SOURCE);
    return page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
        return (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] })).violations;
    });
}

const summary = (v: readonly AxeViolation[]): string => v.map((x) => `${x.id} (${x.impact}) ${JSON.stringify(x.nodes.map((n) => n.target))}`).join('\n');

test.describe('accessibility (F6)', () => {
    test('signed-in canvas has no axe violations', async ({ signedInPage: page }) => {
        expect(summary(await scan(page))).toBe('');
    });

    test('the skip link is reachable by Tab and moves focus to the canvas', async ({ signedInPage: page }) => {
        // Playwright starts Tab navigation from an arbitrary point, so walk the tab order until the link comes up.
        const skip = page.getByRole('link', { name: /skip to/i });
        for (let stop = 0; stop < 60 && !(await skip.evaluate((el) => el === document.activeElement)); stop += 1) {
            await page.keyboard.press('Tab');
        }
        await expect(skip).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('#main-canvas')).toBeFocused();
    });

    test('a card can be created and filled in with the keyboard alone', async ({ signedInPage: page }) => {
        const addButton = page.getByTitle('Add New Node');
        await addButton.focus();
        await page.keyboard.press('Enter');
        const editor = page.locator('.ProseMirror[role=textbox]').first();
        await expect(editor).toBeFocused();
        await page.keyboard.type('Keyboard only card');
        await expect(page.getByText('Keyboard only card')).toBeVisible();
    });
});
