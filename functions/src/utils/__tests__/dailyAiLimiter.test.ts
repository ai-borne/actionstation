/**
 * dailyAiLimiter tests — verifies Firestore transaction-based daily AI counter
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFirestore } from 'firebase-admin/firestore';
import { checkAndIncrementDailyAi } from '../dailyAiLimiter';

vi.mock('firebase-admin/firestore', () => ({
    getFirestore: vi.fn(),
}));

vi.mock('firebase-functions/logger', () => ({
    logger: { error: vi.fn() },
}));

describe('checkAndIncrementDailyAi', () => {
    let mockRunTransaction: ReturnType<typeof vi.fn>;
    let mockDb: Record<string, unknown>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRunTransaction = vi.fn();
        mockDb = { runTransaction: mockRunTransaction, doc: vi.fn() };
        (getFirestore as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
    });

    it('allows generation when count is below limit', async () => {
        const today = new Date().toISOString().slice(0, 10);
        mockRunTransaction.mockImplementation(async (callback) => {
            const tx = {
                get: vi.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ count: 30, date: today }),
                }),
                update: vi.fn(),
            };
            await callback(tx);
            return true;
        });

        const result = await checkAndIncrementDailyAi('user-1', 60);
        expect(result).toBe(true);
    });

    it('blocks generation when count reaches limit', async () => {
        const today = new Date().toISOString().slice(0, 10);
        mockRunTransaction.mockImplementation(async (callback) => {
            const tx = {
                get: vi.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ count: 60, date: today }),
                }),
                update: vi.fn(),
            };
            await callback(tx);
            return false;
        });

        const result = await checkAndIncrementDailyAi('user-1', 60);
        expect(result).toBe(false);
    });

    it('resets count on new day', async () => {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        mockRunTransaction.mockImplementation(async (callback) => {
            const tx = {
                get: vi.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ count: 60, date: yesterday }),
                }),
                update: vi.fn(),
                set: vi.fn(),
            };
            await callback(tx);
            return true;
        });

        const result = await checkAndIncrementDailyAi('user-1', 60);
        expect(result).toBe(true);
    });

    it('initializes counter on first call', async () => {
        mockRunTransaction.mockImplementation(async (callback) => {
            const tx = {
                get: vi.fn().mockResolvedValue({
                    exists: false,
                }),
                set: vi.fn(),
            };
            await callback(tx);
            return true;
        });

        const result = await checkAndIncrementDailyAi('user-1', 60);
        expect(result).toBe(true);
    });

    it('denies generation when transaction fails (fail closed)', async () => {
        mockRunTransaction.mockRejectedValue(new Error('Firestore unavailable'));

        const result = await checkAndIncrementDailyAi('user-1', 60);
        expect(result).toBe(false);
    });
});

