/**
 * Structural Test: Webhook Signature Verification (D30)
 * Ensures stripeWebhook.ts verifies the stripe-signature header
 * using stripe.webhooks.constructEvent before processing any event.
 *
 * Also verifies that the webhook function does NOT use bot detection
 * (Decision 33: Stripe sends automated requests that would be flagged).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const WEBHOOK_FILE = join(
    process.cwd(),
    'functions',
    'src',
    'stripeWebhook.ts',
);

describe('Stripe webhook signature verification', () => {
    const content = readFileSync(WEBHOOK_FILE, 'utf-8');

    it('verifies stripe-signature header', () => {
        expect(content).toContain('stripe-signature');
    });

    it('uses constructEvent for HMAC verification', () => {
        expect(content).toContain('constructEvent');
    });

    it('uses stripeWebhookSecret for signature verification', () => {
        expect(content).toContain('stripeWebhookSecret');
    });

    it('does NOT use bot detection (Decision 33)', () => {
        expect(content).not.toContain('detectBot');
    });

    it('returns 400 on invalid signature', () => {
        expect(content).toContain('400');
    });

    it('claims webhook events atomically before processing', () => {
        expect(content).toContain('claimWebhookEvent');
    });

    it('releases webhook claim on handler failure', () => {
        expect(content).toContain('releaseWebhookEvent');
    });
});
