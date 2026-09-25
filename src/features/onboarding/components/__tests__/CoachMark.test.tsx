import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CoachMark } from '../CoachMark';
import type { CoachMarkProps } from '../CoachMark';

vi.mock('@/shared/hooks/useEscapeLayer', () => ({
    useEscapeLayer: vi.fn((_, active: boolean, handler: () => void) => {
        if (active) (globalThis as Record<string, unknown>).__escapeHandler = handler;
    }),
}));

const DEFAULT_PROPS: CoachMarkProps = {
    targetSelector: '[data-testid="target"]',
    title:          'Create a thought',
    description:    'Each card title becomes your AI prompt.',
    placement:      'right' as const,
    stepLabel:      'Step 1 of 3',
    onNext:         vi.fn(),
    onSkip:         vi.fn(),
    nextLabel:      'Next',
    skipLabel:      'Skip tour',
};

/** Render a target element so CoachMark can find it via getBoundingClientRect */
function renderWithTarget(props = DEFAULT_PROPS) {
    const { container } = render(
        <>
            <div data-testid="target" style={{ width: 100, height: 40 }} />
            <CoachMark {...props} />
        </>,
    );
    return container;
}

describe('CoachMark', () => {
    beforeEach(() => {
        delete (globalThis as Record<string, unknown>).__escapeHandler;
        vi.clearAllMocks();
        // jsdom does not implement ResizeObserver — stub it so the useEffect doesn't throw
        vi.stubGlobal('ResizeObserver', vi.fn(function MockResizeObserver() { return { observe: vi.fn(), disconnect: vi.fn() }; }));
        // jsdom getBoundingClientRect returns zeros; mock to return a real rect
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
            left: 100, top: 100, right: 200, bottom: 140,
            width: 100, height: 40, x: 100, y: 100, toJSON: () => ({}),
        } as DOMRect);
    });

    it('renders title and description from props', () => {
        renderWithTarget();
        expect(screen.getByText(DEFAULT_PROPS.title)).toBeInTheDocument();
        expect(screen.getByText(DEFAULT_PROPS.description)).toBeInTheDocument();
    });

    it('renders tryPrompt in a distinct element when provided', () => {
        renderWithTarget({ ...DEFAULT_PROPS, tryPrompt: 'Try: do something' });
        expect(screen.getByTestId('try-prompt')).toHaveTextContent('Try: do something');
    });

    it('does NOT render tryPrompt element when prop is absent', () => {
        renderWithTarget();
        expect(screen.queryByTestId('try-prompt')).toBeNull();
    });

    it('shows the step label', () => {
        renderWithTarget();
        expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    });

    it('"Next" button calls onNext', () => {
        const onNext = vi.fn();
        renderWithTarget({ ...DEFAULT_PROPS, onNext });
        fireEvent.click(screen.getByText('Next'));
        expect(onNext).toHaveBeenCalledOnce();
    });

    it('"Skip tour" button calls onSkip', () => {
        const onSkip = vi.fn();
        renderWithTarget({ ...DEFAULT_PROPS, onSkip });
        fireEvent.click(screen.getByText('Skip tour'));
        expect(onSkip).toHaveBeenCalledOnce();
    });

    it('renders into portal (document.body)', () => {
        renderWithTarget();
        expect(document.body.querySelector('[data-testid="coach-mark"]')).toBeTruthy();
    });

    it('role="dialog" and aria-modal="true" are present', () => {
        renderWithTarget();
        const el = screen.getByRole('dialog');
        expect(el).toHaveAttribute('aria-modal', 'true');
    });

    it('returns null when target element is not found', () => {
        render(<CoachMark {...DEFAULT_PROPS} targetSelector="[data-testid='nonexistent']" />);
        expect(screen.queryByTestId('coach-mark')).toBeNull();
    });

    it('backdrop clip-path string contains target coordinates', () => {
        renderWithTarget();
        const backdrop = document.body.querySelector('[data-testid="coach-mark-backdrop"]') as HTMLElement;
        expect(backdrop.style.clipPath).toContain('100'); // rect coordinates appear
    });

    it('Escape key → onSkip via useEscapeLayer', () => {
        const onSkip = vi.fn();
        renderWithTarget({ ...DEFAULT_PROPS, onSkip });
        const handler = (globalThis as Record<string, unknown>).__escapeHandler as (() => void) | undefined;
        handler?.();
        expect(onSkip).toHaveBeenCalledOnce();
    });

    it('ResizeObserver is disconnected on unmount', () => {
        const disconnect = vi.fn();
        vi.stubGlobal('ResizeObserver', vi.fn(function MockResizeObserver() { return { observe: vi.fn(), disconnect }; }));
        const { unmount } = render(
            <>
                <div data-testid="target" />
                <CoachMark {...DEFAULT_PROPS} />
            </>,
        );
        unmount();
        expect(disconnect).toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});
