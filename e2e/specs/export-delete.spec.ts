import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/app';
import { stubCallable } from '../fixtures/callable';
import { createCard } from '../fixtures/canvas';
import { getEmulatorUserId } from '../fixtures/emulator';

async function openAccountSettings(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Account' }).click();
}

test.describe('export', () => {
    test('Export Workspace downloads a JSON file containing the cards', async ({ signedInPage: page }) => {
        await createCard(page, 'Exportable card', 'Some exportable body');
        await openAccountSettings(page);

        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export Workspace' }).click();
        const download = await downloadPromise;

        expect(download.suggestedFilename()).toMatch(/\.json$/);
        const exported = readFileSync(await download.path(), 'utf-8');
        expect(() => JSON.parse(exported)).not.toThrow();
        expect(exported).toContain('Exportable card');
    });
});

test.describe('delete account', () => {
    // Server-side erasure (Firestore + Storage cleanup) runs in the onUserDeleted Cloud Function,
    // which is unit-tested in functions/. Here the callable is stubbed and the client half is real:
    // it must call the cleanup first, then delete the Auth user and sign the person out.
    test('deleting the account runs cleanup, removes the Auth user and signs out', async ({ signedInPage: page, request }) => {
        const cleanup = await stubCallable(page, 'onUserDeleted', {
            success: true, firestoreOk: true, storageOk: true, subscriptionCancelled: true,
        });
        await expect(getEmulatorUserId(request)).resolves.toBeTruthy();
        await openAccountSettings(page);

        await page.getByRole('button', { name: 'Delete Account' }).click();
        await expect(page.getByText('Delete Account?')).toBeVisible();
        await page.getByRole('button', { name: 'Delete Permanently' }).click();

        await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0);
        expect(cleanup.count()).toBe(1);
        await expect(getEmulatorUserId(request)).rejects.toThrow(/No account exists/);
    });

    test('cancelling the confirmation keeps the account', async ({ signedInPage: page, request }) => {
        const cleanup = await stubCallable(page, 'onUserDeleted', { success: true, firestoreOk: true, storageOk: true, subscriptionCancelled: true });
        await openAccountSettings(page);
        await page.getByRole('button', { name: 'Delete Account' }).click();
        await page.getByRole('button', { name: /cancel/i }).click();

        expect(cleanup.count()).toBe(0);
        await expect(getEmulatorUserId(request)).resolves.toBeTruthy();
    });
});
