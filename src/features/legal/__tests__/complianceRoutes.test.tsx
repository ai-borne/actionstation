/**
 * Razorpay compliance pages — Contact + Refund & Cancellation.
 * Acceptance: public routes, contact details from the SSOT, refund numbers from pricing.ts.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContactPage } from '../components/ContactPage';
import { RefundPolicy } from '../components/RefundPolicy';
import { TermsContent } from '../components/terms/TermsContent';
import { PrivacyContent } from '../components/privacy/PrivacyContent';
import { resolveLegalRoute } from '../components/legalRoutes';
import { LandingFooter } from '@/features/landing/components/LandingFooter';
import { CONTACT_EMAIL } from '@/config/contact';
import { PRO_ANNUAL_PRICE_LABEL, REFUND_WINDOW_DAYS } from '@/features/subscription/types/pricing';
import { strings } from '@/shared/localization/strings';

describe('ContactPage', () => {
    it('shows email as an actionable detail', () => {
        render(<ContactPage />);
        expect(screen.getByRole('heading', { level: 1, name: strings.legal.contactTitle })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: CONTACT_EMAIL })).toHaveAttribute('href', `mailto:${CONTACT_EMAIL}`);
    });
});

describe('RefundPolicy', () => {
    it('states the refund window, price and how to request from the SSOT values', () => {
        render(<RefundPolicy />);
        expect(screen.getByRole('heading', { level: 1, name: strings.legal.refundTitle })).toBeInTheDocument();
        expect(document.body.textContent).toContain(`${REFUND_WINDOW_DAYS} days`);
        expect(document.body.textContent).toContain(PRO_ANNUAL_PRICE_LABEL);
        expect(screen.getByRole('link', { name: CONTACT_EMAIL })).toBeInTheDocument();
    });

    it('states that the plan does not renew automatically', () => {
        render(<RefundPolicy />);
        expect(document.body.textContent).toMatch(/does not renew/i);
    });
});

describe('resolveLegalRoute', () => {
    it.each(['/terms', '/privacy', '/contact', '/refund'])('resolves %s', (path) => {
        expect(resolveLegalRoute(path)).not.toBeNull();
    });

    it.each(['/', '/login', '/workspace/abc', '/refunds'])('does not claim %s', (path) => {
        expect(resolveLegalRoute(path)).toBeNull();
    });
});

describe('LandingFooter legal links', () => {
    it.each([
        ['terms', '/terms'],
        ['privacy', '/privacy'],
        ['refund', '/refund'],
        ['contact', '/contact'],
    ] as const)('links %s to %s', (key, href) => {
        render(<LandingFooter />);
        expect(screen.getByRole('link', { name: strings.landing.footer[key] })).toHaveAttribute('href', href);
    });
});

describe.each([
    ['Terms', TermsContent],
    ['Privacy', PrivacyContent],
] as const)('%s contact details', (_name, Content) => {
    it('lists email from the contact SSOT', () => {
        render(<Content />);
        const text = document.body.textContent ?? '';
        expect(text).toContain(CONTACT_EMAIL);
    });
});
