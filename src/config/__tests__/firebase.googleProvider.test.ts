/**
 * The login GoogleAuthProvider must request only Firebase's default (non-sensitive)
 * scopes. A sensitive scope on an unverified OAuth app shows Google's
 * "hasn't verified this app" screen to every new user (checklist A10).
 * Calendar access is requested separately by calendarAuthService.
 */
import { describe, it, expect, vi } from 'vitest';

const addScope = vi.fn();

vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/app-check', () => ({
    initializeAppCheck: vi.fn(() => ({})),
    ReCaptchaV3Provider: vi.fn(),
    getToken: vi.fn().mockResolvedValue({ token: 't' }),
}));
vi.mock('firebase/auth', () => ({
    getAuth: vi.fn(() => ({})),
    GoogleAuthProvider: vi.fn(function GoogleAuthProvider(this: { addScope: typeof addScope }) {
        this.addScope = addScope;
    }),
}));
vi.mock('firebase/firestore', () => ({
    initializeFirestore: vi.fn(() => ({})),
    persistentLocalCache: vi.fn(),
    persistentSingleTabManager: vi.fn(),
}));
vi.mock('firebase/storage', () => ({ getStorage: vi.fn(() => ({})) }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(() => ({})) }));
vi.mock('@/shared/services/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

describe('googleProvider (login)', () => {
    it('requests no scopes beyond the Firebase defaults', async () => {
        await import('../firebase');
        expect(addScope).not.toHaveBeenCalled();
    });
});
