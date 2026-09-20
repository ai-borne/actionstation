import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/shared/services/sentryService', () => ({
    captureError: vi.fn(),
}));

describe('validateProductionEnv', () => {
    const REQUIRED_VARS = [
        'VITE_FIREBASE_API_KEY',
        'VITE_FIREBASE_AUTH_DOMAIN',
        'VITE_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_STORAGE_BUCKET',
        'VITE_FIREBASE_MESSAGING_SENDER_ID',
        'VITE_FIREBASE_APP_ID',
        'VITE_CLOUD_FUNCTIONS_URL',
        'VITE_GOOGLE_CLIENT_ID',
        'VITE_RECAPTCHA_SITE_KEY',
        'VITE_TURNSTILE_SITE_KEY',
    ];

    let originalEnv: Record<string, string | undefined>;

    beforeEach(() => {
        originalEnv = {};
        for (const key of REQUIRED_VARS) {
            originalEnv[key] = import.meta.env[key];
        }
        originalEnv.VITE_APP_ENV = import.meta.env.VITE_APP_ENV;
    });

    afterEach(() => {
        for (const [key, val] of Object.entries(originalEnv)) {
            vi.stubEnv(key, val ?? '');
        }
        vi.resetModules();
    });

    it('returns errors for all required vars when they are empty in production', async () => {
        vi.stubEnv('VITE_APP_ENV', 'production');
        for (const key of REQUIRED_VARS) {
            vi.stubEnv(key, '');
        }

        const { validateProductionEnv } = await import('@/config/envValidation');
        const errors = validateProductionEnv();

        expect(errors).toHaveLength(REQUIRED_VARS.length);
        for (const varName of REQUIRED_VARS) {
            expect(errors.some((e: string) => e.includes(varName))).toBe(true);
        }
    });

    it('returns empty array in development mode', async () => {
        vi.stubEnv('VITE_APP_ENV', 'development');

        const { validateProductionEnv } = await import('@/config/envValidation');
        const errors = validateProductionEnv();

        expect(errors).toHaveLength(0);
    });

    it('returns no errors when all vars are set', async () => {
        vi.stubEnv('VITE_APP_ENV', 'production');
        for (const key of REQUIRED_VARS) {
            vi.stubEnv(key, 'test-value');
        }

        const { validateProductionEnv } = await import('@/config/envValidation');
        const errors = validateProductionEnv();

        expect(errors).toHaveLength(0);
    });
});

describe('security strings', () => {
    it('has all required security string keys', async () => {
        const { strings } = await import('@/shared/localization/strings');

        expect(strings.security).toBeDefined();
        expect(typeof strings.security.envMissing).toBe('function');
        expect(strings.security.envMissing('TEST_VAR')).toContain('TEST_VAR');
        expect(typeof strings.security.fetchTimeout).toBe('string');
        expect(typeof strings.security.tokenInvalid).toBe('string');
        expect(typeof strings.security.storageQuotaExceeded).toBe('string');
    });
});
