import { test, expect } from '../fixtures/app';
import { createCard } from '../fixtures/canvas';
import { readPersistedNodes } from '../fixtures/emulator';

const FOLLOWER_BANNER = /open in another tab/i;

test.describe('multiple tabs (F2)', () => {
    test('only the first tab is the editor; a second tab is warned and does not save', async ({ signedInPage: first, context, request }) => {
        await expect(first.getByText(FOLLOWER_BANNER)).toHaveCount(0);

        const second = await context.newPage();
        await second.goto('/');
        await expect(second.locator('.react-flow__pane')).toBeVisible();
        await expect(second.getByText(FOLLOWER_BANNER)).toBeVisible();
        await expect(first.getByText(FOLLOWER_BANNER)).toHaveCount(0);

        // The follower's edits must never overwrite the leader's data.
        await createCard(second, 'Typed in the follower tab', '');
        await second.waitForTimeout(5_000);
        expect(await readPersistedNodes(request)).not.toContain('Typed in the follower tab');

        // The leader keeps saving normally.
        await createCard(first, 'Typed in the leader tab', '');
        await expect.poll(() => readPersistedNodes(request), { timeout: 20_000 }).toContain('Typed in the leader tab');
    });

    test('when the editing tab closes, the other tab takes over and saves', async ({ signedInPage: first, context, request }) => {
        const second = await context.newPage();
        await second.goto('/');
        await expect(second.getByText(FOLLOWER_BANNER)).toBeVisible();

        await first.close();
        await expect(second.getByText(FOLLOWER_BANNER)).toHaveCount(0, { timeout: 20_000 });

        await createCard(second, 'Saved after takeover', '');
        await expect.poll(() => readPersistedNodes(request), { timeout: 20_000 }).toContain('Saved after takeover');
    });
});

test.describe('offline and back online (F3)', () => {
    test('a card created offline is saved once the connection returns', async ({ signedInPage: page, context, request }) => {
        await context.setOffline(true);
        await createCard(page, 'Written while offline', '');
        await page.waitForTimeout(3_000);
        expect(await readPersistedNodes(request)).not.toContain('Written while offline');

        await context.setOffline(false);
        await expect.poll(() => readPersistedNodes(request), { timeout: 45_000 }).toContain('Written while offline');
    });
});
