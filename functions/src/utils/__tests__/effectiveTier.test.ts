/**
 * effectiveTier Tests — server-side Pro resolution honours expiry and isActive.
 */
import { describe, it, expect } from 'vitest';
import { resolveEffectiveTier } from '../effectiveTier.js';

const NOW = 1_800_000_000_000;

describe('resolveEffectiveTier', () => {
    it('is free when there is no subscription document', () => {
        expect(resolveEffectiveTier(undefined, NOW)).toBe('free');
    });

    it('is pro for an active pro plan with a future expiry', () => {
        expect(resolveEffectiveTier({ tier: 'pro', isActive: true, expiresAt: NOW + 1 }, NOW)).toBe('pro');
    });

    it('is pro when expiresAt is absent or null', () => {
        expect(resolveEffectiveTier({ tier: 'pro' }, NOW)).toBe('pro');
        expect(resolveEffectiveTier({ tier: 'pro', expiresAt: null }, NOW)).toBe('pro');
    });

    it('is free once the plan has expired', () => {
        expect(resolveEffectiveTier({ tier: 'pro', isActive: true, expiresAt: NOW - 1 }, NOW)).toBe('free');
    });

    it('is free when the plan is marked inactive', () => {
        expect(resolveEffectiveTier({ tier: 'pro', isActive: false, expiresAt: NOW + 1 }, NOW)).toBe('free');
    });

    it('is free for any non-pro tier', () => {
        expect(resolveEffectiveTier({ tier: 'free', isActive: true }, NOW)).toBe('free');
        expect(resolveEffectiveTier({ tier: 'enterprise' }, NOW)).toBe('free');
    });
});
