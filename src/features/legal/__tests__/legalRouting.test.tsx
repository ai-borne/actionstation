/**
 * Legal Pages — Routing + Component Tests
 * TDD: Written BEFORE implementation (Red → Green → Refactor)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LegalPage } from '../components/LegalPage';
import { TermsOfService } from '../components/TermsOfService';
import { PrivacyPolicy } from '../components/PrivacyPolicy';
import { strings } from '@/shared/localization/strings';

describe('LegalPage', () => {
    it('renders children passed to it', () => {
        render(<LegalPage title="Test Title"><p>Test content</p></LegalPage>);
        expect(screen.getByText('Test content')).toBeInTheDocument();
    });

    it('renders the provided title as an h1', () => {
        render(<LegalPage title="Test Title"><p>c</p></LegalPage>);
        expect(screen.getByRole('heading', { level: 1, name: 'Test Title' })).toBeInTheDocument();
    });

    it('renders back button with correct aria-label from strings', () => {
        render(<LegalPage title="Test"><p>c</p></LegalPage>);
        expect(screen.getByRole('button', { name: strings.legal.backButtonAriaLabel })).toBeInTheDocument();
    });

    it('calls window.history.back on back button click', () => {
        const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
        render(<LegalPage title="Test"><p>c</p></LegalPage>);
        fireEvent.click(screen.getByRole('button', { name: strings.legal.backButtonAriaLabel }));
        expect(backSpy).toHaveBeenCalledOnce();
        backSpy.mockRestore();
    });

    it('displays last updated label from strings', () => {
        render(<LegalPage title="Test"><p>c</p></LegalPage>);
        expect(screen.getByText(new RegExp(strings.legal.lastUpdated))).toBeInTheDocument();
    });

    it('displays last updated date value from strings', () => {
        render(<LegalPage title="Test"><p>c</p></LegalPage>);
        expect(screen.getByText(new RegExp(strings.legal.lastUpdatedValue))).toBeInTheDocument();
    });

    it('renders back button visible label from strings', () => {
        render(<LegalPage title="Test"><p>c</p></LegalPage>);
        expect(screen.getByText(strings.legal.backButtonLabel)).toBeInTheDocument();
    });

    it('renders as a main landmark', () => {
        render(<LegalPage title="Test"><p>c</p></LegalPage>);
        expect(screen.getByRole('main')).toBeInTheDocument();
    });
});

describe('TermsOfService', () => {
    it('renders without crashing', () => {
        render(<TermsOfService />);
    });

    it('has h1 with the terms title from strings', () => {
        render(<TermsOfService />);
        expect(
            screen.getByRole('heading', { level: 1, name: strings.legal.termsTitle })
        ).toBeInTheDocument();
    });

    it('renders inside a main landmark', () => {
        render(<TermsOfService />);
        expect(screen.getByRole('main')).toBeInTheDocument();
    });
});

describe('PrivacyPolicy', () => {
    it('renders without crashing', () => {
        render(<PrivacyPolicy />);
    });

    it('has h1 with the privacy title from strings', () => {
        render(<PrivacyPolicy />);
        expect(
            screen.getByRole('heading', { level: 1, name: strings.legal.privacyTitle })
        ).toBeInTheDocument();
    });

    it('renders inside a main landmark', () => {
        render(<PrivacyPolicy />);
        expect(screen.getByRole('main')).toBeInTheDocument();
    });
});

describe('Legal route registration in App.tsx', () => {
    it('resolves legal routes in AppContent before the auth-loading guard', async () => {
        const { readFileSync } = await import('fs');
        const { fileURLToPath } = await import('url');
        const { resolve, dirname } = await import('path');
        const dir = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(resolve(dir, '../../../App.tsx'), 'utf8');
        // Legal routes are public: they must resolve BEFORE 'if (authLoading)' or a slow auth hides them
        const legalIdx = src.indexOf('resolveLegalRoute(window.location.pathname)');
        const authLoadingGuardIdx = src.indexOf('if (authLoading)');
        expect(legalIdx).toBeGreaterThan(-1);
        expect(legalIdx).toBeLessThan(authLoadingGuardIdx);
    });
});
