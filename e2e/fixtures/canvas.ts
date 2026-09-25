import type { Page } from '@playwright/test';

/** Title and body editors of a card share one class; the title is always the first of a card. */
const EDITOR = '.ProseMirror[role=textbox]';

/** Double-clicks empty canvas at (x, y) to create a card and types its title, then its note. */
export async function createCard(page: Page, title: string, note: string, at = { x: 400, y: 300 }): Promise<void> {
    await page.locator('.react-flow__pane').dblclick({ position: at });
    const editors = page.locator(EDITOR);
    // The newest card is focused, and its title editor is the first editor in focus order.
    await editors.first().pressSequentially(title);
    if (note) {
        await editors.nth(1).pressSequentially(note);
    }
}

/** Types a prompt into a new card in AI mode (`/` → AI Generate) and submits it with Enter. */
export async function generateWithAi(page: Page, prompt: string, at = { x: 400, y: 300 }): Promise<void> {
    await page.locator('.react-flow__pane').dblclick({ position: at });
    const title = page.locator(EDITOR).first();
    await title.pressSequentially('/');
    await page.getByText('AI Generate').first().click();
    await title.pressSequentially(prompt);
    await page.keyboard.press('Enter');
}
