import { test, expect, signIn, suppressFirstRunOverlays } from '../fixtures/app';
import { resetEmulators } from '../fixtures/emulator';

test.describe('sign-in and sign-out', () => {
    test.beforeEach(async ({ page, request }) => {
        await resetEmulators(request);
        await suppressFirstRunOverlays(page);
    });

    test('signed-out visitors see the sign-in screen, not the canvas', async ({ page }) => {
        await page.goto('/login');
        await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();
        await expect(page.locator('.react-flow__pane')).toHaveCount(0);
    });

    test('signing in lands on the canvas and shows the user', async ({ page }) => {
        await signIn(page);
        await expect(page.locator('.react-flow__pane')).toBeVisible();
        await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
    });

    test('the session survives a reload', async ({ page }) => {
        await signIn(page);
        await page.reload();
        await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
    });

    test('signing out leaves the canvas and a reload stays signed out', async ({ page }) => {
        await signIn(page);
        await page.getByRole('button', { name: /sign out/i }).click();
        await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0);
        await expect(page.locator('.react-flow__pane')).toHaveCount(0);
        await page.reload();
        await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0);
        await page.goto('/login');
        await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();
    });
});
