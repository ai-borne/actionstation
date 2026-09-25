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

    test('with three tabs only one edits at a time, and exactly one takes over when it closes', async ({ signedInPage: first, context, request }) => {
        const second = await context.newPage();
        await second.goto('/');
        await expect(second.getByText(FOLLOWER_BANNER)).toBeVisible();
        const third = await context.newPage();
        await third.goto('/');
        await expect(third.getByText(FOLLOWER_BANNER)).toBeVisible();
        await expect(first.getByText(FOLLOWER_BANNER)).toHaveCount(0);

        // Neither follower may write, whatever they type.
        await createCard(second, 'Typed in follower two', '');
        await createCard(third, 'Typed in follower three', '');
        await second.waitForTimeout(5_000);
        const beforeTakeover = await readPersistedNodes(request);
        expect(beforeTakeover).not.toContain('Typed in follower two');
        expect(beforeTakeover).not.toContain('Typed in follower three');

        await first.close();
        await expect.poll(async () => {
            const banners = await Promise.all([second, third].map((tab) => tab.getByText(FOLLOWER_BANNER).count()));
            return banners.reduce((sum, count) => sum + count, 0);
        }, { timeout: 20_000 }).toBe(1);

        // Exactly one tab now edits; the card it holds is saved, the other tab's card still is not.
        const [leader, follower] = (await second.getByText(FOLLOWER_BANNER).count()) === 0 ? [second, third] : [third, second];
        const followerText = leader === second ? 'Typed in follower three' : 'Typed in follower two';
        // The new leader edits the one card it already holds; that edit must now be saved.
        const title = leader.locator('.ProseMirror[role=textbox]').first();
        await title.click();
        await leader.keyboard.press('End');
        await title.pressSequentially(' saved by the new leader');
        await expect.poll(() => readPersistedNodes(request), { timeout: 20_000 }).toContain('saved by the new leader');
        expect(await readPersistedNodes(request)).not.toContain(followerText);
        await expect(follower.getByText(FOLLOWER_BANNER)).toBeVisible();
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

    test('on slow 3G a card still saves and a reload reaches the canvas without errors', async ({ signedInPage: page, context, request }) => {
        test.setTimeout(150_000);
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));

        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', {
            offline: false,
            latency: 400,
            downloadThroughput: (400 * 1024) / 8,
            uploadThroughput: (400 * 1024) / 8,
        });

        await createCard(page, 'Saved on slow 3G', '');
        await expect.poll(() => readPersistedNodes(request), { timeout: 60_000 }).toContain('Saved on slow 3G');

        await page.reload();
        await expect(page.locator('.react-flow__pane')).toBeVisible({ timeout: 90_000 });
        await expect(page.getByText('Saved on slow 3G')).toBeVisible({ timeout: 90_000 });
        expect(pageErrors).toEqual([]);
    });
});
