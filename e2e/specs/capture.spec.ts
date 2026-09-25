import { test, expect } from '../fixtures/app';
import { createCard } from '../fixtures/canvas';
import { readPersistedNodes } from '../fixtures/emulator';

test.describe('capture, save and reload', () => {
    test('a new workspace starts with a canvas and a saved state', async ({ signedInPage: page }) => {
        await expect(page.locator('.react-flow__pane')).toBeVisible();
        await expect(page.getByText(/all changes saved/i)).toBeVisible();
    });

    test('double-clicking the canvas creates an editable card', async ({ signedInPage: page }) => {
        await createCard(page, 'Capture is friction-free', 'Body text for the card');
        await expect(page.locator('.react-flow__node')).toHaveCount(1);
        await expect(page.locator('.react-flow__node')).toContainText('Capture is friction-free');
    });

    test('card content reaches Firestore and is still there after a reload', async ({ signedInPage: page, request }) => {
        await createCard(page, 'Persist me', 'Second brain note');
        // Autosave is debounced, so wait for the write itself rather than the status pill.
        await expect.poll(() => readPersistedNodes(request), { timeout: 20_000 }).toContain('Persist me');
        await expect.poll(() => readPersistedNodes(request)).toContain('Second brain note');
        await page.reload();
        const card = page.locator('.react-flow__node').filter({ hasText: 'Persist me' });
        await expect(card).toHaveCount(1);
    });
});
