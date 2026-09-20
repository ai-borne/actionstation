/**
 * Structural guard (checklist B8): Stripe is deferred, so no client code may reach the
 * Stripe checkout or billing-portal Cloud Functions. Razorpay is the only payment UI.
 * Re-enabling Stripe (checklist H2) means deliberately removing this test with its feature.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const SRC = resolve(__dirname, '..');
const FORBIDDEN = ['createCheckoutSession', 'createBillingPortalSession', 'useBillingPortal', 'checkout.stripe.com', 'billing.stripe.com'];

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) && !name.includes('.test.') ? [path] : [];
    });
}

describe('No Stripe UI path in the client', () => {
    it.each(FORBIDDEN)('no production client source references "%s"', (needle) => {
        const offenders = sourceFiles(SRC).filter((file) => readFileSync(file, 'utf8').includes(needle));
        expect(offenders).toEqual([]);
    });
});
