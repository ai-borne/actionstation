import { test, expect, waitForWorkspace } from '../fixtures/app';
import { STUBBED_AI_ANSWER, stubGeminiProxy } from '../fixtures/ai';
import { stubRazorpayOrder } from '../fixtures/billing';
import { generateWithAi } from '../fixtures/canvas';
import { getEmulatorUserId, readPersistedNodes, seedDocument } from '../fixtures/emulator';

test.describe('AI generation', () => {
    test('a prompt card gets an AI answer and both are saved', async ({ signedInPage: page, request }) => {
        const gemini = await stubGeminiProxy(page);
        await generateWithAi(page, 'Explain spaced repetition');

        await expect(page.locator('.react-flow__node')).toContainText(STUBBED_AI_ANSWER);
        // One call for the answer, one for the auto-generated heading.
        expect(gemini.count()).toBeGreaterThan(0);
        await expect.poll(() => readPersistedNodes(request), { timeout: 20_000 }).toContain(STUBBED_AI_ANSWER);
    });

    test('at the daily AI limit the request is blocked and the user is told why', async ({ signedInPage: page, request }) => {
        const gemini = await stubGeminiProxy(page);
        const uid = await getEmulatorUserId(request);
        const today = new Date().toISOString().slice(0, 10);
        await seedDocument(request, `users/${uid}/usage/aiDaily`, { count: 60, date: today });
        await page.reload();
        await waitForWorkspace(page);

        await generateWithAi(page, 'One prompt too many');

        await expect(page.getByText(/used all your AI generations for today/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /upgrade now/i })).toBeVisible();
        expect(gemini.count()).toBe(0);
    });

    test('the upgrade button in the limit message starts an annual Pro checkout', async ({ signedInPage: page, request }) => {
        await stubGeminiProxy(page);
        const orders = await stubRazorpayOrder(page);
        const uid = await getEmulatorUserId(request);
        await seedDocument(request, `users/${uid}/usage/aiDaily`, { count: 60, date: new Date().toISOString().slice(0, 10) });
        await page.reload();
        await waitForWorkspace(page);
        await generateWithAi(page, 'Trigger the limit');

        await page.getByRole('button', { name: /upgrade now/i }).click();

        await expect.poll(() => orders.length).toBe(1);
        expect(orders[0]).toContain('plan_pro_annual_inr');
    });
});
