import type { Page } from '@playwright/test';

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
} as const;

export const STUBBED_AI_ANSWER = 'Stubbed AI answer about spaced repetition';

/** Answers geminiProxy locally so no test ever reaches Gemini. Returns a counter of real POSTs. */
export async function stubGeminiProxy(page: Page): Promise<{ readonly count: () => number }> {
    let posts = 0;
    await page.route('**/geminiProxy', async (route) => {
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: CORS });
            return;
        }
        posts += 1;
        await route.fulfill({
            status: 200,
            headers: CORS,
            contentType: 'application/json',
            body: JSON.stringify({ candidates: [{ content: { parts: [{ text: STUBBED_AI_ANSWER }] } }] }),
        });
    });
    return { count: () => posts };
}
