import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            'virtual:pwa-register': path.resolve(__dirname, './src/test/mocks/virtualPwaRegister.ts'),
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/functions/**', // Cloud Functions have separate test config
            '**/e2e/**', // Playwright specs run via `npm run e2e`
        ],
        coverage: {
            // Per-file branch+line thresholds for the keyboard shortcut subsystem.
            // Enforced when running: vitest run --coverage
            thresholds: {
                'src/app/hooks/useKeyboardShortcuts.ts': { branches: 90, lines: 90 },
                'src/shared/hooks/useEscapeLayer.ts':    { branches: 90, lines: 90 },
            },
        },
    },
});
