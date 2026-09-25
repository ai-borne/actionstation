import type { Page } from '@playwright/test';
import { test, expect, waitForWorkspace } from '../fixtures/app';
import { countPersistedNodes, getEmulatorUserId, seedDocument } from '../fixtures/emulator';

const FREE_NODE_LIMIT = 12;
const NODE_LIMIT_MESSAGE = /reached the 12-node limit on the free plan/i;
/** Cards are added one click at a time, as a person would; instant back-to-back clicks race the store. */
const CLICK_GAP_MS = 250;
const MAX_CLICKS = 25;

/** Clicks "Add New Node" until the free-tier limit message shows (or `MAX_CLICKS`). Returns true if it showed. */
async function addCardsUntilLimit(page: Page): Promise<boolean> {
    const addNode = page.getByTitle('Add New Node');
    for (let i = 0; i < MAX_CLICKS; i += 1) {
        await addNode.click();
        await page.waitForTimeout(CLICK_GAP_MS);
        if (await page.getByText(NODE_LIMIT_MESSAGE).isVisible()) return true;
    }
    return false;
}

test.describe('free tier gating and Pro', () => {
    test('a free workspace stops at exactly 12 cards and offers an upgrade', async ({ signedInPage: page, request }) => {
        // A click made right after load is occasionally ignored, so keep clicking until the limit
        // message appears; what matters is where creation stops.
        expect(await addCardsUntilLimit(page)).toBe(true);
        await expect(page.getByRole('button', { name: /upgrade/i }).first()).toBeVisible();

        await expect.poll(() => countPersistedNodes(request), { timeout: 20_000 }).toBe(FREE_NODE_LIMIT);
        await page.waitForTimeout(3_000);
        expect(await countPersistedNodes(request)).toBe(FREE_NODE_LIMIT);
    });

    test('a Pro user can go past the free card limit', async ({ signedInPage: page, request }) => {
        const uid = await getEmulatorUserId(request);
        await seedDocument(request, `users/${uid}/subscription/current`, {
            tier: 'pro',
            isActive: true,
            provider: 'razorpay',
            expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        });
        await page.reload();
        await waitForWorkspace(page);

        expect(await addCardsUntilLimit(page)).toBe(false);

        // The canvas only renders cards in view, so count what reached the database instead.
        await expect.poll(() => countPersistedNodes(request), { timeout: 20_000 }).toBeGreaterThan(FREE_NODE_LIMIT);
    });
});
