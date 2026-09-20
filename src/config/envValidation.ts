/**
 * Production Environment Validator
 * Checks that all required env vars are set at app startup.
 * Only validates when VITE_APP_ENV !== 'development'.
 */
import { strings } from '@/shared/localization/strings';
import { captureError } from '@/shared/services/sentryService';
import { logger } from '@/shared/services/logger';

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
] as const;

export function validateProductionEnv(): string[] {
    const env = import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE;
    if (env === 'development') return [];

    const errors: string[] = [];

    for (const name of REQUIRED_VARS) {
        const value = (import.meta.env as Record<string, string | undefined>)[name];
        if (!value || value.trim().length === 0) {
            const msg = strings.security.envMissing(name);
            errors.push(msg);
            logger.error(`[EnvValidation] ${msg}`);
            captureError(new Error(msg), { envVar: name });
        }
    }

    return errors;
}
