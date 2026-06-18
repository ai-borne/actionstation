/**
 * deleteAccount Tests — Firebase account deletion with re-auth
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAnalyticsUser, trackSignOut } from '@/shared/services/analyticsService';
import { clearSentryUser } from '@/shared/services/sentryService';
import { deleteAccount } from '../services/authService';

const mockDeleteUser = vi.fn();
const mockReauthenticateWithPopup = vi.fn();
let mockCurrentUser: { uid: string; email: string } | null = { uid: 'uid-1', email: 'test@example.com' };
const mockClearUser = vi.fn();
const mockReset = vi.fn();
const mockCleanupFn = vi.fn().mockResolvedValue({
    data: { success: true, firestoreOk: true, storageOk: true, subscriptionCancelled: true },
});

vi.mock('firebase/auth', () => ({
    deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
    reauthenticateWithPopup: (...args: unknown[]) => mockReauthenticateWithPopup(...args),
    signInWithPopup: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChanged: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
    httpsCallable: (_app: unknown, _name: unknown) => mockCleanupFn,
}));

vi.mock('@/config/firebase', () => ({
    auth: { get currentUser() { return mockCurrentUser; } },
    googleProvider: { providerId: 'google.com' },
    functions: {},
}));

vi.mock('../stores/authStore', () => ({
    useAuthStore: { getState: () => ({ clearUser: mockClearUser }) },
}));

vi.mock('@/features/subscription/stores/subscriptionStore', () => ({
    useSubscriptionStore: { getState: () => ({ reset: mockReset }) },
}));

vi.mock('@/shared/services/analyticsService', () => ({
    trackSignOut: vi.fn(),
    resetAnalyticsUser: vi.fn(),
    identifyUser: vi.fn(),
    trackSignIn: vi.fn(),
    trackSettingsChanged: vi.fn(),
}));

vi.mock('@/shared/services/sentryService', () => ({
    clearSentryUser: vi.fn(),
    setSentryUser: vi.fn(),
}));

vi.mock('@/shared/services/logger', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('../services/calendarAuthService', () => ({
    checkCalendarConnection: vi.fn(),
}));

describe('deleteAccount', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCurrentUser = { uid: 'uid-1', email: 'test@example.com' };
        mockCleanupFn.mockResolvedValue({
            data: { success: true, firestoreOk: true, storageOk: true, subscriptionCancelled: true },
        });
    });

    it('throws when cleanup reports partial failure', async () => {
        mockDeleteUser.mockResolvedValue(undefined);
        mockCleanupFn.mockResolvedValue({
            data: {
                success: false,
                firestoreOk: false,
                storageOk: true,
                subscriptionCancelled: true,
            },
        });

        await expect(deleteAccount()).rejects.toThrow(
            'Some account data could not be removed. Please try again or contact support before deleting your account.',
        );
        expect(mockDeleteUser).not.toHaveBeenCalled();
        expect(mockClearUser).not.toHaveBeenCalled();
    });

    it('calls deleteUser on the current user', async () => {
        mockDeleteUser.mockResolvedValue(undefined);
        await deleteAccount();
        expect(mockDeleteUser).toHaveBeenCalledWith(mockCurrentUser);
    });

    it('clears user state on success', async () => {
        mockDeleteUser.mockResolvedValue(undefined);
        await deleteAccount();
        expect(mockClearUser).toHaveBeenCalled();
        expect(resetAnalyticsUser).toHaveBeenCalled();
        expect(clearSentryUser).toHaveBeenCalled();
        expect(trackSignOut).toHaveBeenCalled();
        expect(mockReset).toHaveBeenCalled();
    });

    it('re-authenticates and retries on requires-recent-login', async () => {
        const reAuthError = new Error('auth/requires-recent-login');
        Object.assign(reAuthError, { code: 'auth/requires-recent-login' });
        mockDeleteUser.mockRejectedValueOnce(reAuthError).mockResolvedValueOnce(undefined);
        mockReauthenticateWithPopup.mockResolvedValue(undefined);

        await deleteAccount();

        expect(mockReauthenticateWithPopup).toHaveBeenCalledOnce();
        expect(mockDeleteUser).toHaveBeenCalledTimes(2);
    });

    it('propagates error if re-auth fails and does NOT run cleanup', async () => {
        const reAuthError = new Error('auth/requires-recent-login');
        Object.assign(reAuthError, { code: 'auth/requires-recent-login' });
        mockDeleteUser.mockRejectedValue(reAuthError);
        mockReauthenticateWithPopup.mockRejectedValue(new Error('popup-closed'));

        await expect(deleteAccount()).rejects.toThrow('popup-closed');
        expect(mockClearUser).not.toHaveBeenCalled();
        expect(trackSignOut).not.toHaveBeenCalled();
        expect(clearSentryUser).not.toHaveBeenCalled();
        expect(resetAnalyticsUser).not.toHaveBeenCalled();
        expect(mockReset).not.toHaveBeenCalled();
    });

    it('propagates non-reauth errors without retry', async () => {
        mockDeleteUser.mockRejectedValue(new Error('network-error'));

        await expect(deleteAccount()).rejects.toThrow('network-error');
        expect(mockReauthenticateWithPopup).not.toHaveBeenCalled();
    });

    it('throws correct error when no user is signed in', async () => {
        mockCurrentUser = null;
        await expect(deleteAccount()).rejects.toThrow('Please sign in again to complete this action.');
        expect(mockDeleteUser).not.toHaveBeenCalled();
    });

    it('does NOT run cleanup when non-reauth error occurs', async () => {
        mockDeleteUser.mockRejectedValue(new Error('permission-denied'));

        await expect(deleteAccount()).rejects.toThrow('permission-denied');
        expect(mockClearUser).not.toHaveBeenCalled();
        expect(trackSignOut).not.toHaveBeenCalled();
        expect(mockReset).not.toHaveBeenCalled();
    });
});
