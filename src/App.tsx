/**
 * App Entry Point
 * Uses React.lazy for code splitting of non-critical components
 */
import { useEffect, useState, useMemo, useCallback, lazy, Suspense } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/config/queryClient';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { subscribeToAuthState } from '@/features/auth/services/authService';
import { Layout } from '@/app/components/Layout';
import { CanvasView } from '@/features/canvas/components/CanvasView';
import { KeyboardShortcutsProvider } from '@/features/canvas/components/KeyboardShortcutsProvider';
import { SearchInputRefProvider } from '@/features/search/context/SearchInputRefContext';
import { ToastContainer } from '@/shared/components/Toast';
import { ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { LoadingFallback } from '@/shared/components/LoadingFallback';
import { SwUpdatePrompt } from '@/shared/components/SwUpdatePrompt';
import { useAutoApplySwUpdate } from '@/app/hooks/useAutoApplySwUpdate';
import { OfflineFallback } from '@/shared/components/OfflineFallback';
import { useThemeApplicator } from '@/shared/hooks/useThemeApplicator';
import { useCompactMode } from '@/shared/hooks/useCompactMode';
import { useNetworkStatus } from '@/shared/hooks/useNetworkStatus';
import { useQueueDrainer } from '@/app/hooks/useQueueDrainer';
import { useCalendarNodeSync } from '@/features/calendar/hooks/useCalendarNodeSync';
import { useSwRegistration } from '@/shared/hooks/useSwRegistration';
import { useAutosave } from '@/features/workspace/hooks/useAutosave';
import { useWorkspaceLoader } from '@/features/workspace/hooks/useWorkspaceLoader';
import { useWorkspaceStore } from '@/features/workspace/stores/workspaceStore';
import { WorkspaceContext } from '@/app/contexts/WorkspaceContext';
import { usePinnedWorkspaceStore } from '@/features/workspace/stores/pinnedWorkspaceStore';
import { useNetworkStatusStore } from '@/shared/stores/networkStatusStore';
import { strings } from '@/shared/localization/strings';
import { OnboardingWalkthrough } from '@/features/onboarding';
import { CalendarCallback } from '@/features/auth/components/CalendarCallback';
import { TierLimitsProvider } from '@/features/subscription/contexts/TierLimitsContext';
import { TabLeaderProvider } from '@/shared/contexts/TabLeaderContext';
import { MultiTabBanner } from '@/shared/components/MultiTabBanner';
import { SkipLink } from '@/shared/components/SkipLink';
import { ChangelogModal } from '@/features/changelog/components/ChangelogModal';
import { hasNewChangelog } from '@/features/changelog/services/changelogService';
import { resolveLegalRoute } from '@/features/legal/components/legalRoutes';
import '@/styles/global.css';

// Lazy load non-critical components for better initial load performance
const LandingPage = lazy(() =>
    import('@/features/landing/components/LandingPage').then(m => ({ default: m.LandingPage }))
);
const LoginPage = lazy(() =>
    import('@/features/auth/components/LoginPage').then(m => ({ default: m.LoginPage }))
);
const SettingsPanel = lazy(() =>
    import('@/app/components/SettingsPanel').then(m => ({ default: m.SettingsPanel }))
);
const CookieConsentBanner = lazy(() =>
    import('@/features/legal/components/CookieConsentBanner').then(m => ({ default: m.CookieConsentBanner }))
);
const CanvasViewer = lazy(() =>
    import('@/features/canvas/components/CanvasViewer').then(m => ({ default: m.CanvasViewer }))
);

function AuthenticatedApp() {
    const userId = useAuthStore((s) => s.user?.id);
    const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
    const isSwitching = useWorkspaceStore((s) => s.isSwitching);
    const isOnline = useNetworkStatusStore((s) => s.isOnline);
    const {
        isLoading: initialLoading,
        error: loadError,
        hasOfflineData,
    } = useWorkspaceLoader(currentWorkspaceId ?? '');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isChangelogOpen, setIsChangelogOpen] = useState(() => hasNewChangelog());

    useThemeApplicator();
    useCompactMode();
    useNetworkStatus();
    useQueueDrainer();
    useCalendarNodeSync();
    useAutosave(currentWorkspaceId ?? '', initialLoading);

    useEffect(() => {
        if (userId) {
            void usePinnedWorkspaceStore.getState().loadPinnedIds();
        }
    }, [userId]);

    const openSettings = useCallback(() => setIsSettingsOpen(true), []);
    const closeSettings = useCallback(() => setIsSettingsOpen(false), []);
    const closeChangelog = useCallback(() => setIsChangelogOpen(false), []);
    const wsCtx = useMemo(() => ({ currentWorkspaceId, isSwitching }), [currentWorkspaceId, isSwitching]);

    if (!isOnline && loadError && !hasOfflineData) {
        return (
            <OfflineFallback
                hasOfflineData={false}
                onRetry={() => window.location.reload()}
            />
        );
    }
    return (
        <TabLeaderProvider>
            <TierLimitsProvider>
                <WorkspaceContext.Provider value={wsCtx}>
                    <ReactFlowProvider>
                        <SearchInputRefProvider>
                            <KeyboardShortcutsProvider onOpenSettings={openSettings} />
                            <div className="flex flex-col w-full min-h-screen">
                                <MultiTabBanner />
                                <Layout onSettingsClick={openSettings}>
                                    <CanvasView />
                                    {initialLoading && (
                                        <div className="canvas-loading-overlay">
                                            <div className="loading-spinner" />
                                            <p>{strings.common.loading}</p>
                                        </div>
                                    )}
                                </Layout>
                            </div>
                        </SearchInputRefProvider>
                        <Suspense fallback={null}>
                            <SettingsPanel isOpen={isSettingsOpen} onClose={closeSettings} />
                        </Suspense>
                        <OnboardingWalkthrough />
                        <ChangelogModal isOpen={isChangelogOpen} onClose={closeChangelog} />
                    </ReactFlowProvider>
                </WorkspaceContext.Provider>
            </TierLimitsProvider>
        </TabLeaderProvider>
    );
}

/**
 * LoginRoute — handles /login with a safe useEffect redirect for authenticated users.
 * Avoids triggering window.location.href during the render phase (Strict Mode safe).
 */
function LoginRoute() {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

    useEffect(() => {
        if (isAuthenticated) {
            window.location.href = '/';
        }
    }, [isAuthenticated]);

    if (isAuthenticated) return null;

    return (
        <Suspense fallback={<LoadingFallback fullScreen />}>
            <LoginPage />
        </Suspense>
    );
}

function AppContent() {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const authLoading = useAuthStore((s) => s.isLoading);

    // Shareable canvas view — public, no auth required
    const viewMatch = /^\/view\/([\w-]+)$/.exec(window.location.pathname);
    const viewSnapshotId = viewMatch?.[1];
    if (viewSnapshotId) {
        return (
            <Suspense fallback={<LoadingFallback fullScreen />}>
                <CanvasViewer snapshotId={viewSnapshotId} />
            </Suspense>
        );
    }

    // Legal pages — public, require no auth, checked first
    const LegalRoute = resolveLegalRoute(window.location.pathname);
    if (LegalRoute) {
        return (
            <Suspense fallback={<LoadingFallback fullScreen />}>
                <LegalRoute />
            </Suspense>
        );
    }

    // Google Calendar OAuth callback — handle before any auth/workspace checks
    if (window.location.pathname === '/auth/calendar/callback') {
        return <CalendarCallback />;
    }

    // Root: wait for auth to resolve before deciding — prevents landing page flash for returning users
    if (window.location.pathname === '/') {
        if (authLoading) {
            return (
                <div className="loading-screen">
                    <div className="loading-spinner" />
                </div>
            );
        }
        if (isAuthenticated) return <AuthenticatedApp />;
        return (
            <Suspense fallback={<LoadingFallback fullScreen />}>
                <LandingPage />
            </Suspense>
        );
    }

    // Auth loading state
    if (authLoading) {
        return (
            <div className="loading-screen">
                <div className="loading-spinner" />
                <p>{strings.common.loading}</p>
            </div>
        );
    }

    // Login page — explicit route; authenticated users safely redirected via useEffect
    if (window.location.pathname === '/login') {
        return <LoginRoute />;
    }

    // Not authenticated — redirect to login
    if (!isAuthenticated) {
        return (
            <Suspense fallback={<LoadingFallback fullScreen />}>
                <LoginPage />
            </Suspense>
        );
    }

    // Authenticated - show app with workspace loading
    return <AuthenticatedApp />;
}

export function App() {
    const swRegistration = useSwRegistration();
    useAutoApplySwUpdate(swRegistration);

    useEffect(() => {
        const unsubscribe = subscribeToAuthState();
        return unsubscribe;
    }, []);

    return (
        <QueryClientProvider client={queryClient}>
            <ErrorBoundary>
                <SkipLink />
                <AppContent />
                <ToastContainer />
                <ConfirmDialog />
                <SwUpdatePrompt registration={swRegistration} />
                <Suspense fallback={null}>
                    <CookieConsentBanner />
                </Suspense>
            </ErrorBoundary>
        </QueryClientProvider>
    );
}

export default App;
