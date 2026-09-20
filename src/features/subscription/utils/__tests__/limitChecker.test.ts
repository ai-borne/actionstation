/**
 * limitChecker tests — verifies pure limit check function
 * for all LimitKind values across free and pro tiers.
 */
import { describe, it, expect } from 'vitest';
import { checkLimit } from '../limitChecker';
import {
    INITIAL_TIER_LIMITS_STATE,
    FREE_TIER_LIMITS,
    PRO_TIER_LIMITS,
    type TierLimitsState,
} from '../../types/tierLimits';

const freeState = (overrides: Partial<TierLimitsState> = {}): TierLimitsState => ({
    ...INITIAL_TIER_LIMITS_STATE,
    isLoaded: true,
    ...overrides,
});

describe('checkLimit', () => {
    describe('workspace limit', () => {
        it('allows when under free limit', () => {
            const result = checkLimit('workspace', freeState({ workspaceCount: 4 }), 'free');
            expect(result.allowed).toBe(true);
            expect(result.current).toBe(4);
            expect(result.max).toBe(FREE_TIER_LIMITS.maxWorkspaces);
            expect(result.kind).toBe('workspace');
        });

        it('blocks when at free limit', () => {
            const result = checkLimit('workspace', freeState({ workspaceCount: 5 }), 'free');
            expect(result.allowed).toBe(false);
        });

        it('blocks when over free limit', () => {
            const result = checkLimit('workspace', freeState({ workspaceCount: 6 }), 'free');
            expect(result.allowed).toBe(false);
        });

        it('allows pro user under soft cap', () => {
            const result = checkLimit('workspace', freeState({ workspaceCount: 49 }), 'pro');
            expect(result.allowed).toBe(true);
            expect(result.max).toBe(PRO_TIER_LIMITS.maxWorkspaces);
        });

        it('blocks pro user at soft cap', () => {
            const result = checkLimit('workspace', freeState({ workspaceCount: 50 }), 'pro');
            expect(result.allowed).toBe(false);
        });
    });

    describe('node limit', () => {
        it('allows when under free limit', () => {
            const result = checkLimit('node', freeState({ nodeCount: 11 }), 'free');
            expect(result.allowed).toBe(true);
        });

        it('blocks when at free limit', () => {
            const result = checkLimit('node', freeState({ nodeCount: 12 }), 'free');
            expect(result.allowed).toBe(false);
            expect(result.current).toBe(12);
            expect(result.max).toBe(FREE_TIER_LIMITS.maxNodesPerWorkspace);
        });

        it('allows pro user under node soft cap', () => {
            const result = checkLimit('node', freeState({ nodeCount: 499 }), 'pro');
            expect(result.allowed).toBe(true);
        });

        it('blocks pro user at node soft cap', () => {
            const result = checkLimit('node', freeState({ nodeCount: 500 }), 'pro');
            expect(result.allowed).toBe(false);
        });
    });

    describe('aiDaily limit', () => {
        it('allows when under free limit', () => {
            const result = checkLimit('aiDaily', freeState({ aiDailyCount: 59 }), 'free');
            expect(result.allowed).toBe(true);
        });

        it('blocks when at free limit', () => {
            const result = checkLimit('aiDaily', freeState({ aiDailyCount: 60 }), 'free');
            expect(result.allowed).toBe(false);
            expect(result.current).toBe(60);
            expect(result.max).toBe(FREE_TIER_LIMITS.maxAiGenerationsPerDay);
        });

        it('allows pro user under AI soft cap', () => {
            const result = checkLimit('aiDaily', freeState({ aiDailyCount: 499 }), 'pro');
            expect(result.allowed).toBe(true);
        });

        it('blocks pro user at AI soft cap', () => {
            const result = checkLimit('aiDaily', freeState({ aiDailyCount: 500 }), 'pro');
            expect(result.allowed).toBe(false);
        });
    });

    describe('storage limit', () => {
        it('allows when under free limit', () => {
            const result = checkLimit('storage', freeState({ storageMb: 49.9 }), 'free');
            expect(result.allowed).toBe(true);
        });

        it('blocks when at free limit', () => {
            const result = checkLimit('storage', freeState({ storageMb: 50 }), 'free');
            expect(result.allowed).toBe(false);
        });

        it('allows pro user under storage soft cap', () => {
            const result = checkLimit('storage', freeState({ storageMb: 5119 }), 'pro');
            expect(result.allowed).toBe(true);
        });

        it('blocks pro user at storage soft cap', () => {
            const result = checkLimit('storage', freeState({ storageMb: 5120 }), 'pro');
            expect(result.allowed).toBe(false);
        });
    });

    describe('zero count (initial state)', () => {
        it('allows all kinds at zero for free tier', () => {
            const kinds: Array<'workspace' | 'node' | 'aiDaily' | 'storage'> = [
                'workspace', 'node', 'aiDaily', 'storage',
            ];
            for (const kind of kinds) {
                const result = checkLimit(kind, freeState(), 'free');
                expect(result.allowed).toBe(true);
                expect(result.current).toBe(0);
            }
        });
    });
});
