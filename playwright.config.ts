import { defineConfig, devices } from '@playwright/test';

/**
 * Golden-path E2E suite (checklist G12). Runs the app in Vite's `e2e` mode against the Firebase
 * Auth + Firestore + Storage emulators. Nothing here touches production or a real Google account.
 */
const APP_PORT = 5199;
const PROJECT_ID = 'demo-actionstation';

export const APP_URL = `http://127.0.0.1:${APP_PORT}`;

const APP_ENV = {
    VITE_FIREBASE_API_KEY: 'e2e-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: '127.0.0.1',
    VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.appspot.com`,
    VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
    VITE_FIREBASE_APP_ID: '1:1:web:e2e',
    VITE_CLOUD_FUNCTIONS_URL: 'http://127.0.0.1:5001/demo-actionstation/us-central1',
    VITE_RECAPTCHA_SITE_KEY: 'e2e-recaptcha',
    VITE_TURNSTILE_SITE_KEY: '',
    VITE_POSTHOG_KEY: '',
    VITE_SENTRY_DSN: '',
    VITE_GEMINI_API_KEY: '',
    VITE_APP_ENV: 'development',
    // Pin every optional flag so a developer's .env.local can never change what the suite tests
    // (a local VITE_DEV_BYPASS_SUBSCRIPTION=true would make every user Pro).
    VITE_DEV_BYPASS_SUBSCRIPTION: 'false',
    VITE_GOOGLE_CLIENT_ID: '',
    VITE_STRIPE_PUBLISHABLE_KEY: '',
    VITE_APPCHECK_DEBUG_TOKEN: 'e2e-debug-token',
};

export default defineConfig({
    testDir: './e2e/specs',
    outputDir: './e2e/.results',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: APP_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    // Emulators are started by `npm run e2e` (firebase emulators:exec), which also tears them down.
    webServer: {
        command: `npx vite --mode e2e --host 127.0.0.1 --port ${APP_PORT} --strictPort`,
        url: APP_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: APP_ENV,
    },
});
