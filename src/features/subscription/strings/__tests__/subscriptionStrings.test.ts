import { describe, it, expect } from 'vitest';
import { subscriptionStrings } from '../subscriptionStrings';

describe('subscriptionStrings.limits', () => {
    it('AI daily limit copy does not hardcode a tier-specific number (Pro is 500, Free is 60)', () => {
        expect(subscriptionStrings.limits.aiDailyLimit).not.toMatch(/\d/);
    });
});
