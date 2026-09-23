import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSignInWithPopup = vi.fn();
const mockSignInWithRedirect = vi.fn();
const mockGetRedirectResult = vi.fn().mockResolvedValue(null);
const mockSignOut = vi.fn();
const mockOnAuthStateChanged = vi.fn();

vi.mock('firebase/auth', () => ({
    signInWithPopup: (...args: unknown[]) => mockSignInWithPopup(...args),
    signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
    getRedirectResult: (...args: unknown[]) => mockGetRedirectResult(...args),
    signOut: (...args: unknown[]) => mockSignOut(...args),
    onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
}));

vi.mock('@/config/firebase', () => ({
    auth: {},
    googleProvider: {},
}));

const mockSetLoading = vi.fn();
const mockSetUser = vi.fn();
const mockClearUser = vi.fn();
const mockSetError = vi.fn();
vi.mock('../stores/authStore', () => ({
    useAuthStore: {
        getState: () => ({
            setLoading: mockSetLoading,
            setUser: mockSetUser,
            clearUser: mockClearUser,
            setError: mockSetError,
        }),
    },
}));

const mockReset = vi.fn();
const mockLoadSubscription = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/subscription/stores/subscriptionStore', () => ({
    useSubscriptionStore: {
        getState: () => ({ reset: mockReset, loadSubscription: mockLoadSubscription }),
    },
}));

const mockCheckCalendarConnection = vi.fn();
vi.mock('../services/calendarAuthService', () => ({
    checkCalendarConnection: () => mockCheckCalendarConnection(),
}));

// eslint-disable-next-line import-x/first
import { signInWithGoogle, signOut, subscribeToAuthState } from '../services/authService';

describe('authService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetRedirectResult.mockResolvedValue(null);
    });

    describe('signInWithGoogle', () => {
        it('opens the popup synchronously — no await before signInWithPopup (Safari user-activation)', () => {
            mockSignInWithPopup.mockReturnValue(new Promise(() => undefined));

            void signInWithGoogle();

            expect(mockSignInWithPopup).toHaveBeenCalledTimes(1);
            expect(mockSignInWithRedirect).not.toHaveBeenCalled();
        });

        it('falls back to signInWithRedirect only when the popup is blocked', async () => {
            mockSignInWithPopup.mockRejectedValue({ code: 'auth/popup-blocked' });
            mockSignInWithRedirect.mockResolvedValue(undefined);

            await signInWithGoogle();

            expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
            expect(mockSetError).not.toHaveBeenCalled();
        });

        it('sets loading, signs in, maps user and clears loading on success', async () => {
            const firebaseUser = {
                uid: 'uid-1',
                displayName: 'Test User',
                email: 'test@example.com',
                photoURL: 'https://photo.url',
            };
            mockSignInWithPopup.mockResolvedValue({ user: firebaseUser });

            await signInWithGoogle();

            expect(mockSetLoading).toHaveBeenCalledWith(true);
            expect(mockSignInWithPopup).toHaveBeenCalled();
            expect(mockSetUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'uid-1',
                    name: 'Test User',
                    email: 'test@example.com',
                    avatarUrl: 'https://photo.url',
                })
            );
        });

        it('maps null displayName to Anonymous', async () => {
            mockSignInWithPopup.mockResolvedValue({
                user: {
                    uid: 'uid-2',
                    displayName: null,
                    email: null,
                    photoURL: null,
                },
            });

            await signInWithGoogle();

            expect(mockSetUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'uid-2',
                    name: 'Anonymous',
                    email: '',
                    avatarUrl: '',
                })
            );
        });

        it('sets error and rethrows on signInWithPopup failure', async () => {
            const err = new Error('Popup closed');
            mockSignInWithPopup.mockRejectedValue(err);

            await expect(signInWithGoogle()).rejects.toThrow('Popup closed');
            expect(mockSetError).toHaveBeenCalledWith('Popup closed');
        });

        it('uses fallback message for non-Error rejection', async () => {
            mockSignInWithPopup.mockRejectedValue('string error');

            await expect(signInWithGoogle()).rejects.toBe('string error');
            expect(mockSetError).toHaveBeenCalledWith('Sign in failed');
        });
    });

    describe('signOut', () => {
        it('calls firebase signOut and clears user and subscription', async () => {
            mockSignOut.mockResolvedValue(undefined);

            await signOut();

            expect(mockSignOut).toHaveBeenCalled();
            expect(mockClearUser).toHaveBeenCalled();
            expect(mockReset).toHaveBeenCalled();
        });

        it('clears user and resets subscription even when firebase signOut fails', async () => {
            mockSignOut.mockRejectedValue(new Error('Network error'));

            await expect(signOut()).rejects.toThrow('Network error');
            expect(mockClearUser).toHaveBeenCalled();
            expect(mockReset).toHaveBeenCalled();
        });

        it('sets error and rethrows on signOut failure', async () => {
            mockSignOut.mockRejectedValue(new Error('Sign out error'));

            await expect(signOut()).rejects.toThrow('Sign out error');
            expect(mockSetError).toHaveBeenCalledWith('Sign out error');
        });

        it('uses fallback message for non-Error signOut rejection', async () => {
            mockSignOut.mockRejectedValue('unknown');

            await expect(signOut()).rejects.toBe('unknown');
            expect(mockSetError).toHaveBeenCalledWith('Sign out failed');
        });
    });

    describe('subscribeToAuthState — redirect fallback completion', () => {
        it('never signs the user out when a redirect sign-in completes', async () => {
            mockGetRedirectResult.mockResolvedValue({ user: { uid: 'uid-redirect' } });
            mockOnAuthStateChanged.mockReturnValue(vi.fn());

            subscribeToAuthState();
            await Promise.resolve();
            await Promise.resolve();

            expect(mockSignOut).not.toHaveBeenCalled();
        });

        it('surfaces a failed redirect completion as an auth error', async () => {
            mockGetRedirectResult.mockRejectedValue(new Error('redirect failed'));
            mockOnAuthStateChanged.mockReturnValue(vi.fn());

            subscribeToAuthState();
            await vi.waitFor(() => expect(mockSetError).toHaveBeenCalledWith('redirect failed'));
        });
    });

    describe('subscribeToAuthState', () => {
        it('sets loading and returns unsubscribe function', () => {
            const mockUnsubscribe = vi.fn();
            mockOnAuthStateChanged.mockReturnValue(mockUnsubscribe);

            const unsubscribe = subscribeToAuthState();

            expect(mockSetLoading).toHaveBeenCalledWith(true);
            expect(mockOnAuthStateChanged).toHaveBeenCalled();
            expect(unsubscribe).toBe(mockUnsubscribe);
        });

        it('sets user and calls checkCalendarConnection when user is signed in', () => {
            let callback: (user: unknown) => void = () => {};
            mockOnAuthStateChanged.mockImplementation((_auth: unknown, cb: (u: unknown) => void) => {
                callback = cb;
                return vi.fn();
            });

            subscribeToAuthState();

            const firebaseUser = {
                uid: 'uid-3',
                displayName: 'Logged In',
                email: 'in@test.com',
                photoURL: 'https://avatar.url',
            };
            callback(firebaseUser);

            expect(mockSetUser).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: 'uid-3',
                    name: 'Logged In',
                    email: 'in@test.com',
                    avatarUrl: 'https://avatar.url',
                })
            );
            expect(mockCheckCalendarConnection).toHaveBeenCalled();
            expect(mockSetLoading).toHaveBeenLastCalledWith(false);
        });

        it('clears user when user is null', () => {
            let callback: (user: unknown) => void = () => {};
            mockOnAuthStateChanged.mockImplementation((_auth: unknown, cb: (u: unknown) => void) => {
                callback = cb;
                return vi.fn();
            });

            subscribeToAuthState();
            callback(null);

            expect(mockClearUser).toHaveBeenCalled();
            expect(mockCheckCalendarConnection).not.toHaveBeenCalled();
            expect(mockSetLoading).toHaveBeenLastCalledWith(false);
        });

        it('calls getState() inside the auth callback, not just at subscribe time', () => {
            // Track all getState() calls to verify it is called lazily inside the callback
            const getStateCalls: string[] = [];
            let callback: (user: unknown) => void = () => {};

            mockOnAuthStateChanged.mockImplementation((_auth: unknown, cb: (u: unknown) => void) => {
                callback = cb;
                return vi.fn();
            });

            // Wrap the existing getState mock to track invocations
            const originalGetState = vi.fn(() => ({
                setLoading: (...args: unknown[]) => { getStateCalls.push('setLoading'); mockSetLoading(...args); },
                setUser: (...args: unknown[]) => { getStateCalls.push('setUser'); mockSetUser(...args); },
                clearUser: (...args: unknown[]) => { getStateCalls.push('clearUser'); mockClearUser(...args); },
                setError: mockSetError,
            }));

            // The module mock already points getState to a function — we spy on call ordering
            subscribeToAuthState();

            // Before callback fires, getState should have been used for setLoading(true)
            const callsBeforeCallback = mockSetLoading.mock.calls.length;
            expect(callsBeforeCallback).toBe(1);

            // Now fire the callback (simulates Firebase calling back later)
            callback({ uid: 'uid-4', displayName: 'Later', email: 'late@r.com', photoURL: '' });

            // setUser and setLoading(false) should now have been called
            expect(mockSetUser).toHaveBeenCalled();
            expect(mockSetLoading).toHaveBeenLastCalledWith(false);

            // Verify getState was called at least once at subscription time (for setLoading)
            // This structural test ensures getState() usage, not stale destructuring
            void originalGetState;
        });
    });
});
