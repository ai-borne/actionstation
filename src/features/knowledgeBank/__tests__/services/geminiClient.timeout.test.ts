import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/auth/services/authTokenService', () => ({
    getAuthToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('@/shared/utils/appCheckToken', () => ({
    getAppCheckToken: vi.fn().mockResolvedValue('mock-app-check-token'),
}));

// eslint-disable-next-line import-x/first -- Must import after vi.mock
import { callGemini, CLIENT_TIMEOUT_MS } from '../../services/geminiClient';

describe('geminiClient timeout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn());
        vi.stubEnv('VITE_CLOUD_FUNCTIONS_URL', 'https://fn.example.com');
        vi.stubEnv('VITE_GEMINI_API_KEY', '');
    });

    it('passes AbortSignal.timeout to fetch in callViaProxy path', async () => {
        let capturedSignal: AbortSignal | undefined;

        vi.mocked(fetch).mockImplementation((_url, init) => {
            capturedSignal = init?.signal ?? undefined;
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ candidates: [] }),
            } as Response);
        });

        const body = { contents: [{ parts: [{ text: 'test' }] }] };
        await callGemini(body);

        expect(capturedSignal).toBeDefined();
    });

    it('returns error result when fetch rejects (e.g. abort)', async () => {
        vi.mocked(fetch).mockRejectedValue(new Error('The operation was aborted'));

        const body = { contents: [{ parts: [{ text: 'test' }] }] };
        const result = await callGemini(body);

        expect(result.ok).toBe(false);
        expect(result.status).toBe(0);
        expect(result.data).toBeNull();
    });

    it('exports CLIENT_TIMEOUT_MS as a named constant', () => {
        expect(CLIENT_TIMEOUT_MS).toBe(35_000);
    });
});
