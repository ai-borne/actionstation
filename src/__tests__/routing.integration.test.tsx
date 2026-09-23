/**
 * Routing — Integration tests
 * Verifies path-based routing in AppContent renders correct components.
 * TDD: written before route changes in App.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockAuthStore = vi.fn();

vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
        mockAuthStore(selector),
}));

vi.mock('@/features/auth/services/authService', () => ({
    subscribeToAuthState: vi.fn(() => vi.fn()),
}));

vi.mock('@/shared/hooks/useSwRegistration', () => ({
    useSwRegistration: vi.fn(() => ({
        needRefresh: false, offlineReady: false, acceptUpdate: vi.fn(), dismissUpdate: vi.fn(),
    })),
}));

vi.mock('@/shared/components/SwUpdatePrompt', () => ({
    SwUpdatePrompt: () => null,
}));

vi.mock('@/features/legal/components/TermsOfService', () => ({
    TermsOfService: () => <div data-testid="terms-page">Terms</div>,
}));

vi.mock('@/features/legal/components/PrivacyPolicy', () => ({
    PrivacyPolicy: () => <div data-testid="privacy-page">Privacy</div>,
}));

vi.mock('@/features/legal/components/CookieConsentBanner', () => ({
    CookieConsentBanner: () => null,
}));

vi.mock('@/features/landing/components/LandingPage', () => ({
    LandingPage: () => <div data-testid="landing-page">Landing</div>,
}));

vi.mock('@/features/auth/components/LoginPage', () => ({
    LoginPage: () => <div data-testid="login-page">Login</div>,
}));

vi.mock('@/config/queryClient', () => ({
    queryClient: {
        mount: vi.fn(),
        unmount: vi.fn(),
        getQueryCache: vi.fn(() => ({ subscribe: vi.fn(() => vi.fn()) })),
        getMutationCache: vi.fn(() => ({ subscribe: vi.fn(() => vi.fn()) })),
        getDefaultOptions: vi.fn(() => ({})),
        setDefaultOptions: vi.fn(),
    },
}));

// ── AuthenticatedApp dependency mocks ────────────────────────────────────────

vi.mock('@xyflow/react', () => ({
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/canvas/components/CanvasView', () => ({
    CanvasView: () => <div data-testid="canvas-view" />,
}));

vi.mock('@/app/components/Layout', () => ({
    Layout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/canvas/components/KeyboardShortcutsProvider', () => ({
    KeyboardShortcutsProvider: () => null,
}));

vi.mock('@/features/search/context/SearchInputRefContext', () => ({
    SearchInputRefProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/onboarding', () => ({
    OnboardingWalkthrough: () => null,
}));

vi.mock('@/features/subscription/contexts/TierLimitsContext', () => ({
    TierLimitsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/workspace/hooks/useWorkspaceLoader', () => ({
    useWorkspaceLoader: () => ({ isLoading: false, error: null, hasOfflineData: false }),
}));

vi.mock('@/features/workspace/stores/workspaceStore', () => ({
    useWorkspaceStore: (sel: (s: unknown) => unknown) =>
        sel({ currentWorkspaceId: null, isSwitching: false }),
}));

vi.mock('@/shared/stores/networkStatusStore', () => ({
    useNetworkStatusStore: (sel: (s: unknown) => unknown) => sel({ isOnline: true }),
}));

vi.mock('@/features/workspace/stores/pinnedWorkspaceStore', () => ({
    usePinnedWorkspaceStore: {
        getState: () => ({ loadPinnedIds: () => Promise.resolve() }),
    },
}));

vi.mock('@/shared/hooks/useThemeApplicator', () => ({ useThemeApplicator: vi.fn() }));
vi.mock('@/shared/hooks/useCompactMode', () => ({ useCompactMode: vi.fn() }));
vi.mock('@/shared/hooks/useNetworkStatus', () => ({ useNetworkStatus: vi.fn() }));
vi.mock('@/app/hooks/useQueueDrainer', () => ({ useQueueDrainer: vi.fn() }));
vi.mock('@/features/workspace/hooks/useAutosave', () => ({ useAutosave: vi.fn() }));

// ── Helpers ──────────────────────────────────────────────────────────────────

function setPathname(path: string) {
    Object.defineProperty(window, 'location', {
        writable: true,
        value: { pathname: path, href: `http://localhost${path}`, search: '', hash: '' },
    });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAuthStore.mockImplementation(
            (selector: (s: Record<string, unknown>) => unknown) =>
                selector({ isAuthenticated: false, isLoading: false, user: null, error: null }),
        );
    });

    it('renders LandingPage at / for unauthenticated users', async () => {
        setPathname('/');
        const { App } = await import('@/App');
        render(<App />);
        expect(await screen.findByTestId('landing-page')).toBeInTheDocument();
    });

    it('renders spinner at / while auth is loading (prevents flash for returning users)', async () => {
        mockAuthStore.mockImplementation(
            (selector: (s: Record<string, unknown>) => unknown) =>
                selector({ isAuthenticated: false, isLoading: true, user: null, error: null }),
        );
        setPathname('/');
        const { App } = await import('@/App');
        render(<App />);
        // Should show the loading screen, not the landing page
        const loadingScreen = document.querySelector('.loading-screen');
        expect(loadingScreen).toBeInTheDocument();
        expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
    });

    it('renders workspace app at / for authenticated users', async () => {
        mockAuthStore.mockImplementation(
            (selector: (s: Record<string, unknown>) => unknown) =>
                selector({ isAuthenticated: true, isLoading: false, user: { id: 'u1' }, error: null }),
        );
        setPathname('/');
        const { App } = await import('@/App');
        render(<App />);
        expect(await screen.findByTestId('canvas-view')).toBeInTheDocument();
        expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
    });

    it('renders LoginPage at /login for unauthenticated users', async () => {
        setPathname('/login');
        const { App } = await import('@/App');
        render(<App />);
        expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    });

    it('renders TermsOfService at /terms', async () => {
        setPathname('/terms');
        const { App } = await import('@/App');
        render(<App />);
        expect(await screen.findByTestId('terms-page')).toBeInTheDocument();
    });

    it('renders PrivacyPolicy at /privacy', async () => {
        setPathname('/privacy');
        const { App } = await import('@/App');
        render(<App />);
        expect(await screen.findByTestId('privacy-page')).toBeInTheDocument();
    });
});
