import type { Page } from '@playwright/test';

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
} as const;

/**
 * Intercepts the createRazorpayOrder callable so the suite never creates a real order or opens
 * Razorpay Checkout. The stub answers with an error, which ends the flow right after the request
 * the test wants to inspect. Returns the JSON bodies of the calls it saw.
 */
export async function stubRazorpayOrder(page: Page): Promise<readonly string[]> {
    const bodies: string[] = [];
    await page.route('**/createRazorpayOrder', async (route) => {
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: CORS });
            return;
        }
        bodies.push(route.request().postData() ?? '');
        await route.fulfill({
            status: 500,
            headers: CORS,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'stubbed in e2e', status: 'UNAVAILABLE' } }),
        });
    });
    return bodies;
}
