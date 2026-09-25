/**
 * Firestore Backup Unit Tests
 *
 * Verifies:
 * 1. The output URI prefix follows the pattern gs://<bucket>/YYYY-MM-DD
 * 2. A non-OK fetch response throws (causing Cloud Scheduler to mark the job failed)
 * 3. The BACKUP_BUCKET_NAME env override is respected
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock GoogleAuth ───────────────────────────────────────────────────────────
const mockGetAccessToken = vi.fn().mockResolvedValue({ token: 'mock-access-token' });
const mockGetClient = vi.fn().mockResolvedValue({ getAccessToken: mockGetAccessToken });

vi.mock('google-auth-library', () => ({
    GoogleAuth: vi.fn(function MockGoogleAuth() { return { getClient: mockGetClient }; }),
}));

// ── Mock firebase-functions scheduler + logger ────────────────────────────────
type BackupHandler = () => Promise<void>;
let capturedHandler: BackupHandler | null = null;

vi.mock('firebase-functions/v2/scheduler', () => ({
    onSchedule: (_opts: unknown, handler: BackupHandler) => {
        capturedHandler = handler;
        return handler;
    },
}));

vi.mock('firebase-functions/v2', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Capture the last fetch call's outputUriPrefix from the request body */
let lastOutputUriPrefix: string | undefined;

function mockFetchSuccess(operationName = 'projects/test/operations/1234') {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { outputUriPrefix: string };
        lastOutputUriPrefix = body.outputUriPrefix;
        return {
            ok: true,
            status: 200,
            json: () => Promise.resolve({ name: operationName }),
            text: () => Promise.resolve(''),
        };
    }));
}

function mockFetchFailure(status: number, message: string) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(message),
    }));
}

// ─────────────────────────────────────────────────────────────────────────────

describe('firestoreBackup', () => {
    const originalEnv = { ...process.env };

    beforeEach(async () => {
        capturedHandler = null;
        lastOutputUriPrefix = undefined;
        vi.resetModules();
        delete process.env.BACKUP_BUCKET_NAME;
        await import('../firestoreBackup.js');
    });

    afterEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
    });

    it('uses the immutable bucket by default', async () => {
        mockFetchSuccess();
        await capturedHandler!();
        expect(lastOutputUriPrefix).toMatch(/^gs:\/\/actionstation-244f0-firestore-backups-immutable\//);
    });

    it('output URI prefix follows gs://<bucket>/YYYY-MM-DD pattern', async () => {
        mockFetchSuccess();
        await capturedHandler!();
        expect(lastOutputUriPrefix).toMatch(
            /^gs:\/\/[\w-]+-firestore-backups-immutable\/\d{4}-\d{2}-\d{2}$/,
        );
    });

    it('respects BACKUP_BUCKET_NAME env override', async () => {
        process.env.BACKUP_BUCKET_NAME = 'my-custom-backup-bucket';
        vi.resetModules();
        await import('../firestoreBackup.js');

        mockFetchSuccess();
        await capturedHandler!();
        expect(lastOutputUriPrefix).toMatch(/^gs:\/\/my-custom-backup-bucket\//);
    });

    it('throws when the Firestore export API returns a non-OK response', async () => {
        mockFetchFailure(403, 'Permission denied');
        await expect(capturedHandler!()).rejects.toThrow('Export failed (403): Permission denied');
    });

    it('throws when the Firestore export API returns 500', async () => {
        mockFetchFailure(500, 'Internal Server Error');
        await expect(capturedHandler!()).rejects.toThrow('Export failed (500)');
    });

    it('includes today\'s YYYY-MM-DD date in the output URI', async () => {
        const today = new Date().toISOString().slice(0, 10);
        mockFetchSuccess();
        await capturedHandler!();
        expect(lastOutputUriPrefix).toContain(today);
    });
});
