/**
 * CookieConsentBanner Tests — Phase 4.3
 * TDD: Written before implementation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CookieConsentBanner } from '../components/CookieConsentBanner';
import { strings } from '@/shared/localization/strings';

vi.mock('@/shared/services/analyticsService', () => ({
    initAnalytics: vi.fn(),
    optOutAnalytics: vi.fn(),
}));

describe('CookieConsentBanner', () => {
    beforeEach(() => {
        localStorage.clear();
        Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
    });

    it('renders the banner when consent is pending', () => {
        render(<CookieConsentBanner />);
        expect(screen.getByRole('region', { name: strings.legal.consentBannerAriaLabel })).toBeInTheDocument();
    });

    it('does not render when consent is accepted', () => {
        localStorage.setItem('as_analytics_consent', 'accepted');
        render(<CookieConsentBanner />);
        expect(screen.queryByRole('region', { name: strings.legal.consentBannerAriaLabel })).not.toBeInTheDocument();
    });

    it('does not render when consent is rejected', () => {
        localStorage.setItem('as_analytics_consent', 'rejected');
        render(<CookieConsentBanner />);
        expect(screen.queryByRole('region', { name: strings.legal.consentBannerAriaLabel })).not.toBeInTheDocument();
    });

    it('renders accept button with aria-label from strings', () => {
        render(<CookieConsentBanner />);
        expect(screen.getByRole('button', { name: strings.legal.consentAcceptAriaLabel })).toBeInTheDocument();
    });

    it('renders reject button with aria-label from strings', () => {
        render(<CookieConsentBanner />);
        expect(screen.getByRole('button', { name: strings.legal.consentRejectAriaLabel })).toBeInTheDocument();
    });

    it('renders link to /privacy', () => {
        render(<CookieConsentBanner />);
        const link = screen.getByRole('link', { name: strings.legal.consentLearnMore });
        expect(link).toHaveAttribute('href', '/privacy');
    });

    it('renders the banner message text', () => {
        render(<CookieConsentBanner />);
        expect(screen.getByText(strings.legal.consentBannerMessage)).toBeInTheDocument();
    });

    it('dismisses banner after clicking Accept', () => {
        render(<CookieConsentBanner />);
        act(() => { fireEvent.click(screen.getByRole('button', { name: strings.legal.consentAcceptAriaLabel })); });
        expect(screen.queryByRole('region', { name: strings.legal.consentBannerAriaLabel })).not.toBeInTheDocument();
    });

    it('dismisses banner after clicking Reject', () => {
        render(<CookieConsentBanner />);
        act(() => { fireEvent.click(screen.getByRole('button', { name: strings.legal.consentRejectAriaLabel })); });
        expect(screen.queryByRole('region', { name: strings.legal.consentBannerAriaLabel })).not.toBeInTheDocument();
    });

    it('does not render when DNT is enabled (auto-rejected on mount)', () => {
        Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
        render(<CookieConsentBanner />);
        // After mount effect runs, DNT auto-reject should hide the banner
        expect(screen.queryByRole('region', { name: strings.legal.consentBannerAriaLabel })).not.toBeInTheDocument();
    });

    it('renders accept button visible label from strings', () => {
        render(<CookieConsentBanner />);
        expect(screen.getByText(strings.legal.consentAccept)).toBeInTheDocument();
    });

    it('renders reject button visible label from strings', () => {
        render(<CookieConsentBanner />);
        expect(screen.getByText(strings.legal.consentReject)).toBeInTheDocument();
    });
});
