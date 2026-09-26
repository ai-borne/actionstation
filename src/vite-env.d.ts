/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
    readonly VITE_FIREBASE_API_KEY: string;
    readonly VITE_FIREBASE_AUTH_DOMAIN: string;
    readonly VITE_FIREBASE_PROJECT_ID: string;
    readonly VITE_FIREBASE_STORAGE_BUCKET: string;
    readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
    readonly VITE_FIREBASE_APP_ID: string;
    readonly VITE_CLOUD_FUNCTIONS_URL?: string;
    readonly VITE_GEMINI_API_KEY?: string;
    readonly VITE_SENTRY_DSN?: string;
    readonly VITE_APP_ENV?: string;
    readonly VITE_POSTHOG_KEY?: string;
    readonly VITE_POSTHOG_HOST?: string;
    readonly VITE_GOOGLE_CLIENT_ID?: string;
    readonly VITE_DEV_BYPASS_SUBSCRIPTION?: string;
    readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
    readonly VITE_TURNSTILE_SITE_KEY?: string;
    readonly VITE_RECAPTCHA_SITE_KEY: string;
    readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

/** Type declarations for vite-plugin-pwa virtual modules */
declare module 'virtual:pwa-register' {
    export interface RegisterSWOptions {
        immediate?: boolean;
        onNeedRefresh?: () => void;
        onOfflineReady?: () => void;
        onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
        onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
        onRegisterError?: (error: Error) => void;
    }

    export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
