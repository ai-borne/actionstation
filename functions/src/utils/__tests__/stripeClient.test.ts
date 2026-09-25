/**
 * stripeClient Tests
 * Validates singleton caching and reset behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStripeInstance = { checkout: {}, billingPortal: {} };
const MockStripe = vi.fn(function MockStripe() { return mockStripeInstance; });

vi.mock('stripe', () => ({ default: MockStripe }));

vi.mock('firebase-functions/params', () => ({
    defineSecret: (name: string) => ({
        value: () => `mock-${name}`,
    }),
}));

describe('stripeClient', () => {
    beforeEach(async () => {
        vi.resetModules();
        MockStripe.mockClear();
    });

    it('returns a Stripe instance', async () => {
        const { getStripeClient } = await import('../stripeClient.js');
        const client = getStripeClient();
        expect(client).toBe(mockStripeInstance);
    });

    it('returns the same instance on repeated calls (singleton)', async () => {
        const { getStripeClient } = await import('../stripeClient.js');
        const a = getStripeClient();
        const b = getStripeClient();
        expect(a).toBe(b);
        expect(MockStripe).toHaveBeenCalledTimes(1);
    });

    it('creates a fresh instance after resetStripeClient', async () => {
        const { getStripeClient, resetStripeClient } = await import('../stripeClient.js');
        getStripeClient();
        resetStripeClient();
        getStripeClient();
        expect(MockStripe).toHaveBeenCalledTimes(2);
    });

    it('passes the secret key to Stripe constructor', async () => {
        const { getStripeClient } = await import('../stripeClient.js');
        getStripeClient();
        expect(MockStripe).toHaveBeenCalledWith(
            'mock-STRIPE_SECRET_KEY',
            expect.objectContaining({ typescript: true }),
        );
    });
});
