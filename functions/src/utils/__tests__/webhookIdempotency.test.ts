/**
 * webhookIdempotency Tests
 * Validates atomic claim and release against Firestore mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockCreate = vi.fn();
const mockDelete = vi.fn();
const mockDoc = vi.fn(() => ({ get: mockGet, set: mockSet, create: mockCreate, delete: mockDelete }));
const mockCollection = vi.fn(() => ({ doc: mockDoc }));

vi.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({ collection: mockCollection }),
    FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));

vi.mock('firebase-functions', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('webhookIdempotency', () => {
    beforeEach(async () => {
        vi.resetModules();
        mockGet.mockReset();
        mockSet.mockReset();
        mockCreate.mockReset();
        mockDelete.mockReset();
        mockDoc.mockClear();
        mockCollection.mockClear();
    });

    it('claimWebhookEvent returns true when create succeeds', async () => {
        mockCreate.mockResolvedValue(undefined);
        const { claimWebhookEvent } = await import('../webhookIdempotency.js');
        const result = await claimWebhookEvent('evt_new', 'payment.captured', 'user-1');
        expect(result).toBe(true);
        expect(mockCollection).toHaveBeenCalledWith('_webhookEvents');
        expect(mockDoc).toHaveBeenCalledWith('evt_new');
    });

    it('claimWebhookEvent returns false when document already exists', async () => {
        mockCreate.mockRejectedValue({ code: 6 });
        const { claimWebhookEvent } = await import('../webhookIdempotency.js');
        const result = await claimWebhookEvent('evt_dup', 'payment.captured', 'user-1');
        expect(result).toBe(false);
    });

    it('releaseWebhookEvent deletes the claim document', async () => {
        mockDelete.mockResolvedValue(undefined);
        const { releaseWebhookEvent } = await import('../webhookIdempotency.js');
        await releaseWebhookEvent('evt_xyz');
        expect(mockDelete).toHaveBeenCalled();
    });

    it('checkIdempotency returns true when document exists', async () => {
        mockGet.mockResolvedValue({ exists: true });
        const { checkIdempotency } = await import('../webhookIdempotency.js');
        const result = await checkIdempotency('evt_already_processed');
        expect(result).toBe(true);
    });
});
