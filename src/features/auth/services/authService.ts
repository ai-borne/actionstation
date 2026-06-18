/**
 * Auth Service - Firebase Authentication operations
 * Handles Google Sign-In and auth state
 */
import {
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    deleteUser,
    reauthenticateWithPopup,
    type User as FirebaseUser,
} from 'firebase/auth';
import type { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { auth, googleProvider, functions } from '@/config/firebase';
import { useAuthStore } from '../stores/authStore';
import { useSubscriptionStore } from '@/features/subscription/stores/subscriptionStore';
import { createUserFromAuth } from '../types/user';
import { strings } from '@/shared/localization/strings';
import { logger } from '@/shared/services/logger';
import { checkCalendarConnection } from './calendarAuthService';
import { setSentryUser, clearSentryUser } from '@/shared/services/sentryService';
import { identifyUser, resetAnalyticsUser, trackSignIn, trackSignOut } from '@/shared/services/analyticsService';

/**
 * Sign in with Google OAuth
 */
export async function signInWithGoogle(): Promise<void> {
    const { setLoading, setUser, setError } = useAuthStore.getState();

    setLoading(true);

    try {
        const result = await signInWithPopup(auth, googleProvider);
        const firebaseUser = result.user;

        const user = createUserFromAuth(
            firebaseUser.uid,
            firebaseUser.displayName,
            firebaseUser.email,
            firebaseUser.photoURL
        );

        setUser(user);
        setSentryUser(user.id);
        identifyUser(user.id);
        trackSignIn();
    } catch (error) {
        const code = (error as FirebaseError).code;
        // User closed the popup — not a real error, just reset loading state silently
        if (code === 'auth/popup-closed-by-user') {
            useAuthStore.getState().setLoading(false);
            return;
        }
        // Safari / strict popup blockers block window.open() after async work.
        // Fall back to redirect flow — onAuthStateChanged handles the result on return.
        if (code === 'auth/popup-blocked') {
            await signInWithRedirect(auth, googleProvider);
            return;
        }
        const message = error instanceof Error ? error.message : strings.auth.signInFailed;
        setError(message);
        throw error;
    }
}

/**
 * Sign out current user.
 * Always clears local state even if Firebase sign-out fails,
 * preventing an inconsistent "authenticated but no token" state.
 */
export async function signOut(): Promise<void> {
    const { clearUser, setError } = useAuthStore.getState();

    try {
        await firebaseSignOut(auth);
    } catch (error) {
        const message = error instanceof Error ? error.message : strings.auth.signOutFailed;
        setError(message);
        throw error;
    } finally {
        trackSignOut();
        clearUser();
        clearSentryUser();
        resetAnalyticsUser();
        useSubscriptionStore.getState().reset();
    }
}

/**
 * Subscribe to auth state changes
 * Call this once on app initialization
 */
export function subscribeToAuthState(): () => void {
    useAuthStore.getState().setLoading(true);

    // Handle post-redirect sign-in result (Safari popup-blocked fallback)
    getRedirectResult(auth).catch(() => {
        // No redirect result — normal app load, safe to ignore
    });

    return onAuthStateChanged(auth, (firebaseUser: FirebaseUser | null) => {
        if (firebaseUser) {
            const user = createUserFromAuth(
                firebaseUser.uid,
                firebaseUser.displayName,
                firebaseUser.email,
                firebaseUser.photoURL
            );
            useAuthStore.getState().setUser(user);
            setSentryUser(user.id);
            identifyUser(user.id);
            checkCalendarConnection();
            // Load subscription tier on sign-in (D15 — Phase 2)
            void useSubscriptionStore.getState().loadSubscription(user.id);
        } else {
            useAuthStore.getState().clearUser();
            clearSentryUser();
            resetAnalyticsUser();
            useSubscriptionStore.getState().reset();
        }
        useAuthStore.getState().setLoading(false);
    });
}

/**
 * Delete the current user's account.
 * Re-authenticates via Google popup if the session is too old.
 * Calls the onUserDeleted Cloud Function first to clean up Firestore + Storage data
 * (GDPR Article 17 — right to erasure), then deletes the Firebase Auth user.
 */
export async function deleteAccount(): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error(strings.settings.reAuthRequired);

    // Clean up all user data in Firestore and Storage BEFORE deleting auth user
    const cleanupFn = httpsCallable<undefined, {
        success: boolean;
        firestoreOk: boolean;
        storageOk: boolean;
        subscriptionCancelled: boolean;
    }>(functions, 'onUserDeleted');
    const cleanupResult = await cleanupFn();
    const cleanup = cleanupResult.data;
    if (!cleanup.success) {
        logger.warn('[deleteAccount] Partial cleanup before auth deletion', cleanup);
        if (!cleanup.subscriptionCancelled) {
            throw new Error(strings.settings.deleteAccountSubscriptionCancelFailed);
        }
        throw new Error(strings.settings.deleteAccountPartialCleanup);
    }

    try {
        await deleteUser(user);
    } catch (error: unknown) {
        if (!isReauthRequired(error)) throw error;
        await reauthenticateWithPopup(user, googleProvider);
        await deleteUser(user);
    }

    trackSignOut();
    useAuthStore.getState().clearUser();
    clearSentryUser();
    resetAnalyticsUser();
    useSubscriptionStore.getState().reset();
}

function isReauthRequired(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === 'auth/requires-recent-login'
    );
}

