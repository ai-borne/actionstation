/**
 * LoginPage Component Tests — Phase 4.2
 * Tests that terms / privacy links are present and navigable.
 * Phase 6.4: Adds Turnstile interaction tests (regression for existing integration).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from '../components/LoginPage';
import { strings } from '@/shared/localization/strings';
import { signInWithGoogle, signOut } from '../services/authService';

// ─── Mocks ────────────────────────────────────────────────────────────────

const { mockUseTurnstile } = vi.hoisted(() => ({
    mockUseTurnstile: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue(true),
        isLoading: false,
        error: null,
    }),
}));

vi.mock('../stores/authStore', () => ({
    useAuthStore: (selector: (s: { isLoading: boolean; error: null }) => unknown) =>
        selector({ isLoading: false, error: null }),
}));

vi.mock('../hooks/useTurnstile', () => ({
    useTurnstile: mockUseTurnstile,
}));

vi.mock('../services/authService', () => ({
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
}));

// Reset mocks to safe defaults before each test
beforeEach(() => {
    vi.clearAllMocks();
    mockUseTurnstile.mockReturnValue({
        execute: vi.fn().mockResolvedValue(true),
        isLoading: false,
        error: null,
    });
    vi.mocked(signInWithGoogle).mockResolvedValue(undefined);
    vi.mocked(signOut).mockResolvedValue(undefined);
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

// ─── Turnstile interaction tests (Phase 6.4 — regression for existing integration) ───

describe('LoginPage — Turnstile interaction', () => {
    it('sign-in button is disabled and shows loading label when turnstile.isLoading is true', () => {
        mockUseTurnstile.mockReturnValue({
            execute: vi.fn().mockResolvedValue(true),
            isLoading: true,
            error: null,
        });
        render(<LoginPage />);
        const btn = screen.getByRole('button', { name: strings.auth.signingIn });
        expect(btn).toBeDisabled();
    });

    it('renders turnstile error message when turnstile.error is set', () => {
        mockUseTurnstile.mockReturnValue({
            execute: vi.fn().mockResolvedValue(false),
            isLoading: false,
            error: 'Challenge verification failed',
        });
        render(<LoginPage />);
        expect(screen.getByRole('alert')).toHaveTextContent('Challenge verification failed');
    });

    it('calls signInWithGoogle immediately (before Turnstile verification) so the popup opens synchronously', async () => {
        mockUseTurnstile.mockReturnValue({
            execute: vi.fn().mockResolvedValue(true),
            isLoading: false,
            error: null,
        });
        render(<LoginPage />);
        fireEvent.click(screen.getByRole('button', { name: strings.auth.signInWithGoogle }));
        await waitFor(() => {
            expect(signInWithGoogle).toHaveBeenCalledTimes(1);
        });
    });

    it('signs the user back out when Turnstile verification fails after popup sign-in', async () => {
        mockUseTurnstile.mockReturnValue({
            execute: vi.fn().mockResolvedValue(false),
            isLoading: false,
            error: null,
        });
        render(<LoginPage />);
        fireEvent.click(screen.getByRole('button', { name: strings.auth.signInWithGoogle }));
        await waitFor(() => {
            expect(signInWithGoogle).toHaveBeenCalledTimes(1);
            expect(signOut).toHaveBeenCalledTimes(1);
        });
    });

    it('does NOT sign out when Turnstile verification succeeds', async () => {
        mockUseTurnstile.mockReturnValue({
            execute: vi.fn().mockResolvedValue(true),
            isLoading: false,
            error: null,
        });
        render(<LoginPage />);
        fireEvent.click(screen.getByRole('button', { name: strings.auth.signInWithGoogle }));
        await waitFor(() => {
            expect(signInWithGoogle).toHaveBeenCalledTimes(1);
        });
        expect(signOut).not.toHaveBeenCalled();
    });

    it('does not attempt Turnstile verification or sign-out when signInWithGoogle itself fails/cancels', async () => {
        const execute = vi.fn().mockResolvedValue(true);
        mockUseTurnstile.mockReturnValue({ execute, isLoading: false, error: null });
        vi.mocked(signInWithGoogle).mockRejectedValueOnce(new Error('popup closed'));
        render(<LoginPage />);
        fireEvent.click(screen.getByRole('button', { name: strings.auth.signInWithGoogle }));
        await waitFor(() => {
            expect(signInWithGoogle).toHaveBeenCalledTimes(1);
        });
        expect(execute).not.toHaveBeenCalled();
        expect(signOut).not.toHaveBeenCalled();
    });
});
