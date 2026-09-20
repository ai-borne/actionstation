/**
 * useConsentState Tests — Phase 4.3
 * TDD: Written before implementation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { useConsentState } from '../hooks/useConsentState';

const mockInitAnalytics = vi.fn();
const mockOptOutAnalytics = vi.fn();
vi.mock('@/shared/services/analyticsService', () => ({
    initAnalytics: (...args: unknown[]) => mockInitAnalytics(...args),
    optOutAnalytics: (...args: unknown[]) => mockOptOutAnalytics(...args),
}));

// ── Test harness ─────────────────────────────────────────────────────────────
function ConsentTestHarness() {
    const { choice, accept, reject } = useConsentState();
    return (
        <div>
            <span data-testid="choice">{choice}</span>
            <button onClick={accept}>accept</button>
            <button onClick={reject}>reject</button>
        </div>
    );
}

describe('useConsentState', () => {
    beforeEach(() => {
        localStorage.clear();
        mockInitAnalytics.mockClear();
        mockOptOutAnalytics.mockClear();
        Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
    });

    it('initial choice is pending when no prior consent', () => {
        render(<ConsentTestHarness />);
        expect(screen.getByTestId('choice').textContent).toBe('pending');
    });

    it('initial choice is accepted when localStorage has accepted', () => {
        localStorage.setItem('as_analytics_consent', 'accepted');
        render(<ConsentTestHarness />);
        expect(screen.getByTestId('choice').textContent).toBe('accepted');
    });

    it('initial choice is rejected when localStorage has rejected', () => {
        localStorage.setItem('as_analytics_consent', 'rejected');
        render(<ConsentTestHarness />);
        expect(screen.getByTestId('choice').textContent).toBe('rejected');
    });

    it('accept() transitions state to accepted', () => {
        render(<ConsentTestHarness />);
        act(() => { fireEvent.click(screen.getByText('accept')); });
        expect(screen.getByTestId('choice').textContent).toBe('accepted');
    });

    it('reject() transitions state to rejected', () => {
        render(<ConsentTestHarness />);
        act(() => { fireEvent.click(screen.getByText('reject')); });
        expect(screen.getByTestId('choice').textContent).toBe('rejected');
    });

    it('accept() calls initAnalytics', () => {
        render(<ConsentTestHarness />);
        act(() => { fireEvent.click(screen.getByText('accept')); });
        expect(mockInitAnalytics).toHaveBeenCalledOnce();
    });

    it('reject() does NOT call initAnalytics', () => {
        render(<ConsentTestHarness />);
        act(() => { fireEvent.click(screen.getByText('reject')); });
        expect(mockInitAnalytics).not.toHaveBeenCalled();
    });

    it('reject() calls optOutAnalytics', () => {
        render(<ConsentTestHarness />);
        act(() => { fireEvent.click(screen.getByText('reject')); });
        expect(mockOptOutAnalytics).toHaveBeenCalledOnce();
    });

    it('calls initAnalytics on mount when already accepted', () => {
        localStorage.setItem('as_analytics_consent', 'accepted');
        render(<ConsentTestHarness />);
        expect(mockInitAnalytics).toHaveBeenCalledOnce();
    });

    it('accept() persists accepted to localStorage', () => {
        render(<ConsentTestHarness />);
        act(() => { fireEvent.click(screen.getByText('accept')); });
        expect(localStorage.getItem('as_analytics_consent')).toBe('accepted');
    });

    it('reject() persists rejected to localStorage', () => {
        render(<ConsentTestHarness />);
        act(() => { fireEvent.click(screen.getByText('reject')); });
        expect(localStorage.getItem('as_analytics_consent')).toBe('rejected');
    });

    it('auto-rejects when DNT is enabled and choice is pending', () => {
        Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
        render(<ConsentTestHarness />);
        expect(screen.getByTestId('choice').textContent).toBe('rejected');
        expect(localStorage.getItem('as_analytics_consent')).toBe('rejected');
    });

    it('does not auto-reject when already accepted (DNT set after acceptance)', () => {
        localStorage.setItem('as_analytics_consent', 'accepted');
        Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
        render(<ConsentTestHarness />);
        // accepted wins over DNT auto-reject
        expect(screen.getByTestId('choice').textContent).toBe('accepted');
    });

    it('dispatch actions are isolated from Zustand (no getState, no useStore calls)', async () => {
        const { readFileSync } = await import('fs');
        const { fileURLToPath } = await import('url');
        const { resolve, dirname } = await import('path');
        const dir = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(resolve(dir, '../hooks/useConsentState.ts'), 'utf8');
        expect(src).not.toMatch(/useStore|getState\(\)/);
        expect(src).toMatch(/useReducer/);
    });
});
