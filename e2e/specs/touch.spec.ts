import { test, expect, waitForWorkspace, signIn, suppressFirstRunOverlays } from '../fixtures/app';
import { createCard } from '../fixtures/canvas';
import { resetEmulators } from '../fixtures/emulator';
import { readViewport, touchGesture } from '../fixtures/touch';

test.use({ hasTouch: true, viewport: { width: 820, height: 1100 } });

const PANE = { x: 400, y: 600 };

test.describe('touch on the canvas (F5)', () => {
    test.beforeEach(async ({ page, request }) => {
        await resetEmulators(request);
        await suppressFirstRunOverlays(page);
        await signIn(page);
        await waitForWorkspace(page);
    });

    test('pinching two fingers apart zooms in', async ({ page }) => {
        const before = await readViewport(page);
        await touchGesture(page, [{ x: PANE.x - 40, y: PANE.y }, { x: PANE.x + 40, y: PANE.y }], [{ x: PANE.x - 160, y: PANE.y }, { x: PANE.x + 160, y: PANE.y }]);
        expect((await readViewport(page)).zoom).toBeGreaterThan(before.zoom);
    });

    test('dragging one finger on empty canvas pans it', async ({ page }) => {
        const before = await readViewport(page);
        await touchGesture(page, [{ x: PANE.x, y: PANE.y }], [{ x: PANE.x - 150, y: PANE.y - 100 }]);
        const after = await readViewport(page);
        expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(50);
    });

    test('dragging a card with one finger moves that card', async ({ page }) => {
        await createCard(page, 'Touch me', '', { x: 300, y: 300 });
        await page.keyboard.press('Escape');
        const card = page.locator('.react-flow__node').first();
        const before = await card.boundingBox();
        if (!before) throw new Error('card not visible');
        const start = { x: before.x + before.width / 2, y: before.y + 6 };
        await touchGesture(page, [start], [{ x: start.x + 120, y: start.y + 90 }]);
        const after = await card.boundingBox();
        expect(after?.x ?? 0).toBeGreaterThan(before.x + 50);
    });
});
