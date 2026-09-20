/**
 * Gemini Client Proxy Fallback Tests — fallback to direct API on proxy errors
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/features/auth/services/authTokenService', () => ({
    getAuthToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('@/shared/utils/appCheckToken', () => ({
    getAppCheckToken: vi.fn().mockResolvedValue('mock-app-check-token'),
}));

// eslint-disable-next-line import-x/first -- Must import after vi.mock
import { callGemini } from '../../services/geminiClient';
// eslint-disable-next-line import-x/first
import type { GeminiRequestBody } from '../../services/geminiClient';

const TEST_BODY: GeminiRequestBody = {
    contents: [{ parts: [{ text: 'Hello' }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
};

function geminiJsonResponse(text: string) {
    return { candidates: [{ content: { parts: [{ text }] } }] };
}

describe('geminiClient proxy fallback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn());
        vi.stubEnv('VITE_CLOUD_FUNCTIONS_URL', '');
        vi.stubEnv('VITE_GEMINI_API_KEY', '');
    });

    describe('proxy fallback to direct on network error', () => {
        it('falls back to direct key when proxy fetch throws', async () => {
            vi.stubEnv('VITE_CLOUD_FUNCTIONS_URL', 'http://localhost:5001/project/us-central1');
            vi.stubEnv('VITE_GEMINI_API_KEY', 'fallback-key');

            const directResponse = geminiJsonResponse('Fallback result');

            vi.mocked(fetch)
                .mockRejectedValueOnce(new TypeError('Failed to fetch'))
                .mockResolvedValueOnce({
                    ok: true, status: 200,
                    json: () => Promise.resolve(directResponse),
                } as Response);

            const result = await callGemini(TEST_BODY);

            expect(fetch).toHaveBeenCalledTimes(2);
            expect(result.ok).toBe(true);
            expect(result.data).toEqual(directResponse);

            const directUrl = vi.mocked(fetch).mock.calls[1]![0] as string;
            expect(directUrl).toContain('generativelanguage.googleapis.com');
            expect(directUrl).toContain('key=fallback-key');
        });

        it('returns failure when proxy throws and no direct key exists', async () => {
            vi.stubEnv('VITE_CLOUD_FUNCTIONS_URL', 'http://localhost:5001/project/us-central1');

            vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

            const result = await callGemini(TEST_BODY);

            expect(fetch).toHaveBeenCalledTimes(1);
            expect(result).toEqual({ ok: false, status: 0, data: null });
        });

        it('falls back to direct key on proxy 500 error in DEV', async () => {
            vi.stubEnv('VITE_CLOUD_FUNCTIONS_URL', 'https://fn.example.com');
            vi.stubEnv('VITE_GEMINI_API_KEY', 'fallback-key');

            const directResponse = geminiJsonResponse('Recovered from 500');
            vi.mocked(fetch)
                .mockResolvedValueOnce({
                    ok: false, status: 500,
                    json: () => Promise.resolve({ error: { message: 'Internal', code: 500 } }),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true, status: 200,
                    json: () => Promise.resolve(directResponse),
                } as Response);

            const result = await callGemini(TEST_BODY);

            expect(fetch).toHaveBeenCalledTimes(2);
            expect(result.ok).toBe(true);
            expect(result.data).toEqual(directResponse);
        });

        it('falls back to direct key on proxy 502 error', async () => {
            vi.stubEnv('VITE_CLOUD_FUNCTIONS_URL', 'https://fn.example.com');
            vi.stubEnv('VITE_GEMINI_API_KEY', 'fallback-key');

            const directResponse = geminiJsonResponse('Direct fallback');
            vi.mocked(fetch)
                .mockResolvedValueOnce({
                    ok: false, status: 502,
                    json: () => Promise.resolve({ error: { message: 'Bad gateway' } }),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true, status: 200,
                    json: () => Promise.resolve(directResponse),
                } as Response);

            const result = await callGemini(TEST_BODY);

            expect(fetch).toHaveBeenCalledTimes(2);
            expect(result.ok).toBe(true);
            expect(result.data).toEqual(directResponse);
            const directUrl = vi.mocked(fetch).mock.calls[1]![0] as string;
            expect(directUrl).toContain('generativelanguage.googleapis.com');
        });

        it('falls back to direct key on proxy 401 error', async () => {
            vi.stubEnv('VITE_CLOUD_FUNCTIONS_URL', 'https://fn.example.com');
            vi.stubEnv('VITE_GEMINI_API_KEY', 'fallback-key');

            const directResponse = geminiJsonResponse('Auth fallback');
            vi.mocked(fetch)
                .mockResolvedValueOnce({
                    ok: false, status: 401,
                    json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
                } as Response)
                .mockResolvedValueOnce({
                    ok: true, status: 200,
                    json: () => Promise.resolve(directResponse),
                } as Response);

            const result = await callGemini(TEST_BODY);

            expect(fetch).toHaveBeenCalledTimes(2);
            expect(result.ok).toBe(true);
        });

        it('does not fall back on proxy transient error when no direct key', async () => {
            vi.stubEnv('VITE_CLOUD_FUNCTIONS_URL', 'https://fn.example.com');

            vi.mocked(fetch).mockResolvedValueOnce({
                ok: false, status: 502,
                json: () => Promise.resolve({ error: { message: 'Bad gateway' } }),
            } as Response);

            const result = await callGemini(TEST_BODY);

            expect(fetch).toHaveBeenCalledTimes(1);
            expect(result.ok).toBe(false);
            expect(result.status).toBe(502);
        });
    });
});
