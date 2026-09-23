import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
    plugins: [
        tailwindcss(),
        react(),
        VitePWA({
            registerType: 'prompt',
            includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
            manifest: false, // Using manual manifest.json in public/
            workbox: {
                // Precache app shell: HTML, JS, CSS, fonts
                globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
                // Skip large source maps and dev files
                globIgnores: ['**/node_modules/**', '**/sw.js', '**/workbox-*.js'],
                // Clean old caches on new SW activation
                cleanupOutdatedCaches: true,
                // Take control immediately on activation
                clientsClaim: true,
                // Never answer Firebase Hosting's reserved /__/ paths with the SPA shell.
                // authDomain is this origin, so /__/auth/handler (sign-in popup) and
                // /__/auth/iframe (auth relay) are same-origin navigations — serving
                // index.html for them replaces Firebase's auth helpers with the app.
                navigateFallbackDenylist: [/^\/__\//],
                // Runtime caching strategies for API calls
                runtimeCaching: [
                    {
                        // Static assets: cache first (images, fonts, SVGs)
                        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|woff2?)$/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'static-assets',
                            expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
                        },
                    },
                    {
                        // Firebase Firestore REST: stale-while-revalidate
                        urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'firestore-api',
                            expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
                        },
                    },
                    // NOTE: Firebase Auth endpoints are intentionally NOT cached.
                    // Auth tokens must never be stored in the Cache API (security risk
                    // on shared devices). Firebase SDK handles its own token refresh.
                ],
            },
            devOptions: {
                enabled: false, // Disable in dev to avoid confusion
            },
        }),
    ],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    // ReactFlow - largest dependency, separate chunk
                    if (id.includes('@xyflow')) {
                        return 'vendor-reactflow';
                    }
                    // Firebase - second largest, separate chunk
                    if (id.includes('firebase')) {
                        return 'vendor-firebase';
                    }
                    // Analytics — lazy-loaded after first paint
                    if (id.includes('posthog')) {
                        return 'vendor-analytics';
                    }
                    // Sentry — deferred init, keep out of main chunk
                    if (id.includes('@sentry')) {
                        return 'vendor-sentry';
                    }
                    // State management libraries
                    if (id.includes('zustand') || id.includes('@tanstack')) {
                        return 'vendor-state';
                    }
                    // Core React runtime (grouped with other node_modules)
                    return undefined;
                },
            },
        },
        // Increase warning limit since we're intentionally chunking
        chunkSizeWarningLimit: 600,
    },
});
