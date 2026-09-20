/**
 * Gemini Client Tests — systemInstruction serialization (snake_case)
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
import type { GeminiRequestBody, GeminiResponse } from '../../services/geminiClient';

const TEST_BODY: GeminiRequestBody = {
    contents: [{ parts: [{ text: 'Hello' }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
};

function geminiJsonResponse(text: string): GeminiResponse {
    return { candidates: [{ content: { parts: [{ text }] } }] };
}

describe('geminiClient systemInstruction serialization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn());
        vi.stubEnv('VITE_CLOUD_FUNCTIONS_URL', '');
        vi.stubEnv('VITE_GEMINI_API_KEY', '');
    });

    describe('systemInstruction serialization', () => {
        const bodyWithSystem: GeminiRequestBody = {
            contents: [{ parts: [{ text: 'User prompt' }] }],
            generationConfig: { temperature: 0.7 },
            systemInstruction: { parts: [{ text: 'You are a helpful assistant.' }] },
        };

        it('serializes systemInstruction as system_instruction (snake_case) in direct path', async () => {
            vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key');
            vi.mocked(fetch).mockResolvedValue({
                ok: true, status: 200,
                json: () => Promise.resolve(geminiJsonResponse('ok')),
            } as Response);

            await callGemini(bodyWithSystem);

            const fetchBody = JSON.parse(
                vi.mocked(fetch).mock.calls[0]![1]!.body as string
            ) as Record<string, unknown>;
            expect(fetchBody).toHaveProperty('system_instruction');
            expect(fetchBody).not.toHaveProperty('systemInstruction');
            expect(fetchBody.system_instruction).toEqual({
                parts: [{ text: 'You are a helpful assistant.' }],
            });
        });

        it('serializes systemInstruction as system_instruction (snake_case) in proxy path', async () => {
            vi.stubEnv('VITE_CLOUD_FUNCTIONS_URL', 'https://fn.example.com');
            vi.mocked(fetch).mockResolvedValue({
                ok: true, status: 200,
                json: () => Promise.resolve(geminiJsonResponse('ok')),
            } as Response);

            await callGemini(bodyWithSystem);

            const fetchBody = JSON.parse(
                vi.mocked(fetch).mock.calls[0]![1]!.body as string
            ) as Record<string, unknown>;
            expect(fetchBody).toHaveProperty('system_instruction');
            expect(fetchBody).not.toHaveProperty('systemInstruction');
        });

        it('omits system_instruction when systemInstruction is not provided', async () => {
            vi.stubEnv('VITE_GEMINI_API_KEY', 'test-key');
            vi.mocked(fetch).mockResolvedValue({
                ok: true, status: 200,
                json: () => Promise.resolve(geminiJsonResponse('ok')),
            } as Response);

            await callGemini(TEST_BODY);

            const fetchBody = JSON.parse(
                vi.mocked(fetch).mock.calls[0]![1]!.body as string
            ) as Record<string, unknown>;
            expect(fetchBody).not.toHaveProperty('system_instruction');
            expect(fetchBody).not.toHaveProperty('systemInstruction');
        });
    });
});
