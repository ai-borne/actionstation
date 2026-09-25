import type { Page } from '@playwright/test';

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
} as const;

/**
 * Answers a Firebase callable function locally (the Functions emulator is not part of this suite)
 * and returns a live counter of how many times the app invoked it.
 */
export async function stubCallable(page: Page, name: string, result: unknown): Promise<{ readonly count: () => number }> {
    let calls = 0;
    await page.route(`**/${name}`, async (route) => {
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: CORS });
            return;
        }
        calls += 1;
        await route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ result }) });
    });
    return { count: () => calls };
}
