/**
 * LoginPage Component Tests — Phase 4.2
 * Tests that terms / privacy links are present and navigable.
 * Turnstile is verified on mount (useTurnstileGate) so the click can open the
 * Google popup synchronously — required by Safari's user-activation window.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoginPage } from '../components/LoginPage';
import { strings } from '@/shared/localization/strings';
import { signInWithGoogle } from '../services/authService';

// ─── Mocks ────────────────────────────────────────────────────────────────

interface GateState { isVerified: boolean; isLoading: boolean; error: string | null; retry: () => void }

const { mockUseTurnstileGate } = vi.hoisted(() => ({
    mockUseTurnstileGate: vi.fn<() => GateState>(),
}));

vi.mock('../stores/authStore', () => ({
    useAuthStore: (selector: (s: { isLoading: boolean; error: null }) => unknown) =>
        selector({ isLoading: false, error: null }),
}));

vi.mock('../hooks/useTurnstileGate', () => ({
    useTurnstileGate: mockUseTurnstileGate,
}));

vi.mock('../services/authService', () => ({
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
}));

function gate(overrides: Partial<GateState> = {}): GateState {
    return { isVerified: true, isLoading: false, error: null, retry: vi.fn(), ...overrides };
}

// Reset mocks to safe defaults before each test
beforeEach(() => {
    vi.clearAllMocks();
    mockUseTurnstileGate.mockReturnValue(gate());
    vi.mocked(signInWithGoogle).mockResolvedValue(undefined);
});

// ─── Terms and privacy links ──────────────────────────────────────────────

describe('LoginPage — terms and privacy links', () => {
    it('renders a link to /terms', () => {
        render(<LoginPage />);
        const link = screen.getByRole('link', { name: strings.auth.termsOfServiceLabel });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', '/terms');
    });

    it('renders a link to /privacy', () => {
        render(<LoginPage />);
        const link = screen.getByRole('link', { name: strings.auth.privacyPolicyLabel });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', '/privacy');
    });

    it('terms link opens in same tab (no target=_blank)', () => {
        render(<LoginPage />);
        const link = screen.getByRole('link', { name: strings.auth.termsOfServiceLabel });
        expect(link).not.toHaveAttribute('target', '_blank');
    });

    it('privacy link opens in same tab (no target=_blank)', () => {
        render(<LoginPage />);
        const link = screen.getByRole('link', { name: strings.auth.privacyPolicyLabel });
        expect(link).not.toHaveAttribute('target', '_blank');
    });

    it('renders app name heading', () => {
        render(<LoginPage />);
        expect(screen.getByRole('heading', { level: 1, name: strings.app.name })).toBeInTheDocument();
    });

    it('renders sign-in button', () => {
        render(<LoginPage />);
        expect(screen.getByRole('button', { name: strings.auth.signInWithGoogle })).toBeInTheDocument();
    });
});

// ─── Turnstile gate + sign-in click ───────────────────────────────────────

describe('LoginPage — Turnstile gate and sign-in', () => {
    it('sign-in button is disabled and shows loading label while the challenge runs', () => {
        mockUseTurnstileGate.mockReturnValue(gate({ isVerified: false, isLoading: true }));
        render(<LoginPage />);
        expect(screen.getByRole('button', { name: strings.auth.signingIn })).toBeDisabled();
    });

    it('renders the Turnstile error message', () => {
        mockUseTurnstileGate.mockReturnValue(gate({ isVerified: false, error: 'Challenge verification failed' }));
        render(<LoginPage />);
        expect(screen.getByRole('alert')).toHaveTextContent('Challenge verification failed');
    });

    it('calls signInWithGoogle synchronously within the click (keeps the popup inside the user gesture)', () => {
        render(<LoginPage />);
        fireEvent.click(screen.getByRole('button', { name: strings.auth.signInWithGoogle }));
        // No waitFor: any await before this call would push window.open() out of
        // Safari's user-activation window and the popup would be blocked.
        expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    });

    it('re-runs the challenge instead of signing in when not yet verified', () => {
        const retry = vi.fn();
        mockUseTurnstileGate.mockReturnValue(gate({ isVerified: false, error: 'failed', retry }));
        render(<LoginPage />);
        fireEvent.click(screen.getByRole('button', { name: strings.auth.signInWithGoogle }));
        expect(retry).toHaveBeenCalledTimes(1);
        expect(signInWithGoogle).not.toHaveBeenCalled();
    });

    it('swallows a rejected sign-in (error is surfaced via the auth store)', async () => {
        vi.mocked(signInWithGoogle).mockRejectedValueOnce(new Error('popup closed'));
        render(<LoginPage />);
        fireEvent.click(screen.getByRole('button', { name: strings.auth.signInWithGoogle }));
        await Promise.resolve();
        expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    });
});
