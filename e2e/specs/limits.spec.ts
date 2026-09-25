import type { Page } from '@playwright/test';
import { test, expect, signIn, suppressFirstRunOverlays, waitForWorkspace } from '../fixtures/app';
import { countPersistedNodes, getEmulatorUserId, resetEmulators, seedDocument } from '../fixtures/emulator';

const FREE_NODE_LIMIT = 12;
const NODE_LIMIT_MESSAGE = /reached the 12-node limit on the free plan/i;
/** Cards are added one click at a time, as a person would. */
const CLICK_GAP_MS = 250;

async function addCards(page: Page, howMany: number): Promise<void> {
    const addNode = page.getByTitle('Add New Node');
    for (let i = 0; i < howMany; i += 1) {
        await addNode.click();
        await page.waitForTimeout(CLICK_GAP_MS);
    }
}

test.describe('free tier gating and Pro', () => {
    test('a free workspace stops at exactly 12 cards and offers an upgrade', async ({ signedInPage: page, request }) => {
        await addCards(page, FREE_NODE_LIMIT);
        await expect.poll(() => countPersistedNodes(request), { timeout: 20_000 }).toBe(FREE_NODE_LIMIT);
        await expect(page.getByText(NODE_LIMIT_MESSAGE)).toHaveCount(0);

        await addCards(page, 1);

        await expect(page.getByText(NODE_LIMIT_MESSAGE)).toBeVisible();
        await expect(page.getByRole('button', { name: /upgrade/i }).first()).toBeVisible();
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

        await addCards(page, FREE_NODE_LIMIT + 1);

        await expect.poll(() => countPersistedNodes(request), { timeout: 20_000 }).toBe(FREE_NODE_LIMIT + 1);
        await expect(page.getByText(NODE_LIMIT_MESSAGE)).toHaveCount(0);
    });
});

test('the add button is disabled until the workspace has loaded, so an early click is never lost', async ({ page, request }) => {
    await resetEmulators(request);
    await suppressFirstRunOverlays(page);
    await signIn(page);

    const addNode = page.getByTitle('Add New Node');
    // Click the moment sign-in completes, with no waiting; Playwright waits while it is disabled.
    await addNode.click();
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    await page.waitForTimeout(3_000);
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
});
