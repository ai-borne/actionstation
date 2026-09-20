/**
 * Application Entry Point
 * Registers PWA service worker for offline-first capability
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EnvConfigError } from '@/shared/components/EnvConfigError';
import { initWebVitals } from '@/shared/services/performanceService';
import { initSentry } from '@/shared/services/sentryService';
import { validateProductionEnv } from '@/config/envValidation';

const envErrors = validateProductionEnv();

// Defer Sentry and analytics until after first paint — both are non-critical
// for the initial render and their bundles are large.
const scheduleIdle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (cb: () => void) => setTimeout(cb, 1);
scheduleIdle(() => { void initSentry(); });

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Root element not found');
}

createRoot(rootElement).render(
    <StrictMode>
        {envErrors.length > 0 ? <EnvConfigError errors={envErrors} /> : <App />}
    </StrictMode>
);

// Initialize web vitals monitoring (non-blocking)
void initWebVitals();
