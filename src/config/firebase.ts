/**
 * Firebase Configuration
 * SECURITY: API keys here are client-safe (restricted by domain in Firebase Console)
 * Sensitive operations go through Cloud Functions
 */
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider, getToken } from 'firebase/app-check';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { logger } from '@/shared/services/logger';
import { connectEmulatorsIfE2e } from './firebaseEmulators';

// These values should come from environment variables in production
const firebaseConfig = {
    apiKey: (import.meta.env.VITE_FIREBASE_API_KEY || '').trim(),
    authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
    projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim(),
    storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
    messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
    appId: (import.meta.env.VITE_FIREBASE_APP_ID || '').trim(),
};

// Validate config in development
if (import.meta.env.DEV && !firebaseConfig.apiKey) {
    logger.warn(
        'Firebase config not found. Create .env.local with VITE_FIREBASE_* variables.'
    );
}

export const app = initializeApp(firebaseConfig);

// Firebase App Check — protects backend resources from abuse.
// In dev: FIREBASE_APPCHECK_DEBUG_TOKEN=true makes the SDK generate a debug token
// and log it to the browser console as: "App Check debug token: <uuid>"
// Add that token in Firebase Console → App Check → Apps → ⋮ → Manage debug tokens
if (import.meta.env.DEV) {
    // Use a fixed debug token from .env.local so all dev browsers share the same
    // registered token. Falls back to auto-generate (true) if not set.
    // Register the token in Firebase Console → App Check → Apps → Manage debug tokens.
    // @ts-expect-error — Firebase App Check debug flag (not in standard types)
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN ?? true;
}
export const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
});

// Pre-warm the App Check token immediately on module init.
// Resolves once the reCAPTCHA token is obtained, or resolves silently on failure
// (enforcement may not be enabled yet). Awaited by useSaveCallback before the
// first Firestore write to prevent a race where autosave fires before the token
// is available, causing a permission-denied on the very first save.
export const appCheckReady: Promise<void> = getToken(appCheck, /* forceRefresh */ false)
    .then(() => undefined)
    .catch((err: unknown) => {
        logger.warn('[AppCheck] Initial token prefetch failed — saves may fail until token is available', err);
    });

export const auth = getAuth(app);

// Enable offline persistence for instant workspace switching
// Uses the new PersistentLocalCache API (replaces deprecated enableIndexedDbPersistence)
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentSingleTabManager(undefined),
    }),
});

export const storage = getStorage(app);
export const functions = getFunctions(app);

// Playwright E2E only (`vite --mode e2e`): route every service to the local emulators.
connectEmulatorsIfE2e(import.meta.env.MODE, { auth, db, storage, functions });

// Login requests only Firebase's default (non-sensitive) scopes. Sensitive scopes such as
// Calendar are requested on opt-in by calendarAuthService (see noSensitiveLoginScope test).
export const googleProvider = new GoogleAuthProvider();
