/**
 * Effective tier — what a subscription document entitles a user to RIGHT NOW.
 * The client applies the same expiry rule in subscriptionService; the server must
 * not trust `tier: 'pro'` alone because nothing rewrites the document at expiry.
 */

export type EffectiveTier = 'free' | 'pro';

export function resolveEffectiveTier(
    data: Record<string, unknown> | undefined,
    now: number = Date.now(),
): EffectiveTier {
    if (!data || data.tier !== 'pro') return 'free';
    if (data.isActive === false) return 'free';
    const expiresAt = data.expiresAt;
    if (typeof expiresAt === 'number' && expiresAt <= now) return 'free';
    return 'pro';
}
