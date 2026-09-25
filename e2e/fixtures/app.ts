import { test as base, expect, type Page } from '@playwright/test';
import { CHANGELOG_VERSION } from '../../src/features/changelog/data/changelogEntries';
import { STORAGE_KEY, WELCOME_STORAGE_KEY } from '../../src/features/onboarding/types/onboarding';
import { resetEmulators } from './emulator';

/** Signs in through the Auth emulator's fake Google popup with a freshly generated account. */
export async function signIn(page: Page): Promise<void> {
    await page.goto('/login');
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: /sign in with google/i }).click();
    const popup = await popupPromise;
    // Wait for the account list to load first, otherwise its render replaces the form we open.
    await expect(popup.getByText(/no google\.com accounts exist/i)).toBeVisible();
    await popup.getByText('Add new account').click();
    await popup.getByRole('button', { name: /auto-generate/i }).click();
    await popup.getByRole('button', { name: /sign in with google/i }).click();
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
}

/**
 * Marks first-run UI as already seen (welcome screen, demo cards, coach-mark tour, What's New
 * modal, analytics banner) so tests start on the bare canvas. Uses the app's own storage keys.
 */
export async function suppressFirstRunOverlays(page: Page): Promise<void> {
    await page.addInitScript(
        ([onboardingDone, welcomeShown, changelogVersion]) => {
            localStorage.setItem(onboardingDone, 'true');
            localStorage.setItem(welcomeShown, 'true');
            localStorage.setItem('lastSeenChangelog', changelogVersion);
            localStorage.setItem('as_analytics_consent', 'rejected');
        },
        [STORAGE_KEY, WELCOME_STORAGE_KEY, CHANGELOG_VERSION] as const,
    );
}

/**
 * The canvas renders before the workspace and tier limits finish loading, and actions in that
 * window (adding a card, for instance) are silently ignored. Wait for the workspace to appear.
 */
export async function waitForWorkspace(page: Page): Promise<void> {
    await expect(page.getByText('Untitled Workspace')).toBeVisible();
    await expect(page.getByText(/all changes saved/i)).toBeVisible();
    await expect(page.getByTitle('Add New Node')).toBeEnabled();
}

interface AppFixtures {
    /** A page that is signed in as a fresh emulator user with first-run overlays suppressed. */
    readonly signedInPage: Page;
}

export const test = base.extend<AppFixtures>({
    signedInPage: async ({ page, request }, use) => {
        await resetEmulators(request);
        await suppressFirstRunOverlays(page);
        await signIn(page);
        await waitForWorkspace(page);
        await use(page);
    },
});

export { expect };
