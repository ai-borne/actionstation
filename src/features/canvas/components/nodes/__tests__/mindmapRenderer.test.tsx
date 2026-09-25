/**
 * MindmapRenderer Tests — TDD: Validates rendering, pointer isolation,
 * accessibility, empty/error handling, cleanup lifecycle, D3 zoom
 * disabling, scroll jitter suppression, and RAF deduplication.
 *
 * Strategy: markmap-view requires a real DOM (SVG operations). We mock
 * the Markmap class and Transformer to verify the component's integration
 * contract without requiring a full browser SVG engine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { strings } from '@/shared/localization/strings';
import { MindmapRenderer } from '../MindmapRenderer';

// ── Mocks (hoisted to avoid "Cannot access before initialization") ───
const { mockSetData, mockFit, mockDestroy, mockTransform, mockCreate, mockSvgOn } = vi.hoisted(() => {
    const mockFit = vi.fn().mockResolvedValue(undefined);
    const mockSetData = vi.fn().mockResolvedValue(undefined);
    const mockDestroy = vi.fn();
    const mockSvgOn = vi.fn().mockReturnThis();
    const mockTransform = vi.fn().mockReturnValue({
        root: { content: 'Topic', children: [] },
    });
    const mockCreate = vi.fn().mockReturnValue({
        setData: mockSetData,
        fit: mockFit,
        destroy: mockDestroy,
        svg: { on: mockSvgOn },
    });
    return { mockSetData, mockFit, mockDestroy, mockTransform, mockCreate, mockSvgOn };
});

vi.mock('markmap-lib', () => ({
    Transformer: vi.fn().mockImplementation(function MockTransformer() {
        return { transform: mockTransform };
    }),
}));

vi.mock('markmap-view', () => ({
    Markmap: { create: mockCreate },
    deriveOptions: vi.fn().mockReturnValue({}),
}));

describe('MindmapRenderer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal(
            'ResizeObserver',
            vi.fn(function MockResizeObserver() { return { observe: vi.fn(), disconnect: vi.fn() }; }),
        );
        vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { cb(0); return 1; }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    it('renders an SVG element', () => {
        const { container } = render(
            <MindmapRenderer markdown="# Topic" />,
        );
        const svg = container.querySelector('svg');
        expect(svg).toBeInTheDocument();
    });

    it('sets aria-label for accessibility on container and SVG', () => {
        render(<MindmapRenderer markdown="# Topic" />);
        const elements = screen.getAllByLabelText(strings.canvas.mindmap.ariaLabel);
        expect(elements.length).toBeGreaterThanOrEqual(1);
        expect(screen.getByTestId('mindmap-renderer')).toHaveAttribute('aria-label', strings.canvas.mindmap.ariaLabel);
    });

    it('has data-testid for test targeting', () => {
        render(<MindmapRenderer markdown="# Topic" />);
        expect(screen.getByTestId('mindmap-renderer')).toBeInTheDocument();
    });

    it('calls Markmap.create on mount with autoFit disabled', () => {
        render(<MindmapRenderer markdown="# Topic" />);
        expect(mockCreate).toHaveBeenCalledTimes(1);
        const [, options] = mockCreate.mock.calls[0] as [unknown, Record<string, unknown>];
        expect(options.autoFit).toBe(false);
    });

    it('calls setData with transformed root', () => {
        render(<MindmapRenderer markdown="# Topic" />);
        expect(mockSetData).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'Topic' }),
        );
    });

    it('calls fit after setData via scheduleFit', async () => {
        render(<MindmapRenderer markdown="# Topic" />);
        await waitFor(() => {
            expect(mockFit).toHaveBeenCalled();
        });
    });

    it('calls destroy on unmount (cleanup)', () => {
        const { unmount } = render(
            <MindmapRenderer markdown="# Topic" />,
        );
        unmount();
        expect(mockDestroy).toHaveBeenCalledTimes(1);
    });

    it('cancels pending RAF on unmount', () => {
        const { unmount } = render(
            <MindmapRenderer markdown="# Topic" />,
        );
        unmount();
        expect(vi.mocked(cancelAnimationFrame)).toHaveBeenCalled();
    });

    describe('D3 zoom — canvas node (disableZoom defaults to true)', () => {
        it('disables ALL D3 zoom event listeners on the SVG by default', () => {
            render(<MindmapRenderer markdown="# Topic" />);
            expect(mockSvgOn).toHaveBeenCalledWith('.zoom', null);
        });

        it('disables the wheel pan handler on the SVG by default', () => {
            render(<MindmapRenderer markdown="# Topic" />);
            expect(mockSvgOn).toHaveBeenCalledWith('wheel', null);
        });

        it('does NOT stop wheel propagation so canvas pan still works', () => {
            render(<MindmapRenderer markdown="# Topic" />);
            const container = screen.getByTestId('mindmap-renderer');
            const event = new WheelEvent('wheel', { bubbles: true });
            const stopSpy = vi.spyOn(event, 'stopPropagation');
            container.dispatchEvent(event);
            expect(stopSpy).not.toHaveBeenCalled();
        });
    });

    describe('D3 zoom — focus overlay (disableZoom=false)', () => {
        it('does NOT strip D3 zoom listeners when disableZoom=false', () => {
            render(<MindmapRenderer markdown="# Topic" disableZoom={false} />);
            expect(mockSvgOn).not.toHaveBeenCalledWith('.zoom', null);
        });

        it('does NOT strip wheel handler when disableZoom=false', () => {
            render(<MindmapRenderer markdown="# Topic" disableZoom={false} />);
            expect(mockSvgOn).not.toHaveBeenCalledWith('wheel', null);
        });

        it('explicitly passes disableZoom=true strips zoom (explicit default)', () => {
            render(<MindmapRenderer markdown="# Topic" disableZoom={true} />);
            expect(mockSvgOn).toHaveBeenCalledWith('.zoom', null);
            expect(mockSvgOn).toHaveBeenCalledWith('wheel', null);
        });
    });

    describe('foreignObject pointer isolation (prevents dblclick/scroll blocking)', () => {
        it('CSS sets pointer-events:none on .markmap-foreign so foreignObjects cannot intercept events', () => {
            const { container } = render(<MindmapRenderer markdown="# Topic" />);
            const style = container.querySelector('style');
            const allStyles = Array.from(document.styleSheets)
                .flatMap(ss => { try { return Array.from(ss.cssRules).map(r => r.cssText); } catch { return []; } })
                .join('\n');
            const cssText = (style?.textContent ?? '') + allStyles;
            expect(cssText).toMatch(/markmap-foreign[^}]*pointer-events\s*:\s*none/);
        });

        it('does NOT stop dblclick propagation — double-click reaches parent node for focus overlay', () => {
            let dblclickReached = false;
            const { container } = render(
                <div onDoubleClick={() => { dblclickReached = true; }}>
                    <MindmapRenderer markdown="# Topic" />
                </div>,
            );
            const mindmapEl = container.querySelector('[data-testid="mindmap-renderer"]')!;
            const event = new MouseEvent('dblclick', { bubbles: true });
            mindmapEl.dispatchEvent(event);
            expect(dblclickReached).toBe(true);
        });
    });

    describe('pointer isolation (prevents ReactFlow drag on mindmap click)', () => {
        it('stops pointerDown propagation', () => {
            render(<MindmapRenderer markdown="# Topic" />);
            const container = screen.getByTestId('mindmap-renderer');
            const event = new MouseEvent('pointerdown', { bubbles: true });
            const stopSpy = vi.spyOn(event, 'stopPropagation');
            container.dispatchEvent(event);
            expect(stopSpy).toHaveBeenCalled();
        });

        it('focuses nearest [tabindex="0"] ancestor on pointerDown so Escape reaches the canvas', () => {
            const focusSpy = vi.fn();
            const { container: wrapper } = render(
                <div tabIndex={0} onFocus={focusSpy}>
                    <MindmapRenderer markdown="# Topic" />
                </div>,
            );
            const focusable = wrapper.querySelector<HTMLElement>('[tabindex="0"]')!;
            const focusMethod = vi.spyOn(focusable, 'focus');

            const mindmapContainer = screen.getByTestId('mindmap-renderer');
            const event = new MouseEvent('pointerdown', { bubbles: true });
            mindmapContainer.dispatchEvent(event);

            expect(focusMethod).toHaveBeenCalledWith({ preventScroll: true });
        });
    });

    describe('empty / fallback handling', () => {
        it('transforms empty markdown with fallback string', () => {
            render(<MindmapRenderer markdown="" />);
            expect(mockTransform).toHaveBeenCalledWith(
                expect.stringContaining(strings.canvas.mindmap.emptyFallback),
            );
        });
    });

    describe('theme-aware text color (dark mode fix)', () => {
        it('passes a style function to Markmap.create', () => {
            render(<MindmapRenderer markdown="# Topic" />);
            const [, options] = mockCreate.mock.calls[0] as [unknown, Record<string, unknown>];
            expect(typeof options.style).toBe('function');
        });

        it('style function maps --markmap-text-color to app variable', () => {
            render(<MindmapRenderer markdown="# Topic" />);
            const [, options] = mockCreate.mock.calls[0] as [unknown, Record<string, unknown>];
            const css = (options.style as (id: string) => string)('test-id');
            expect(css).toContain('--markmap-text-color');
            expect(css).toContain('--color-text-primary');
        });

        it('style function maps --markmap-code-bg to surface variable', () => {
            render(<MindmapRenderer markdown="# Topic" />);
            const [, options] = mockCreate.mock.calls[0] as [unknown, Record<string, unknown>];
            const css = (options.style as (id: string) => string)('test-id');
            expect(css).toContain('--markmap-code-bg');
            expect(css).toContain('--color-surface');
        });

        it('style function scopes rules to the markmap instance id', () => {
            render(<MindmapRenderer markdown="# Topic" />);
            const [, options] = mockCreate.mock.calls[0] as [unknown, Record<string, unknown>];
            const css = (options.style as (id: string) => string)('my-instance');
            expect(css).toContain('my-instance');
        });
    });

    describe('ResizeObserver — jitter suppression (defense-in-depth)', () => {
        it('does NOT call fit() when size differs by less than 4px (scroll jitter)', () => {
            let cb: ((entries: ResizeObserverEntry[]) => void) | null = null;
            vi.stubGlobal('ResizeObserver', vi.fn(function MockResizeObserver(f: (entries: ResizeObserverEntry[]) => void) {
                cb = f;
                return { observe: vi.fn(), disconnect: vi.fn() };
            }));

            render(<MindmapRenderer markdown="# Topic" />);
            vi.clearAllMocks();

            cb!([{ contentBoxSize: [{ inlineSize: 400, blockSize: 300 }] }] as unknown as ResizeObserverEntry[]);
            vi.clearAllMocks();

            // 3px jitter — within the 4px threshold
            cb!([{ contentBoxSize: [{ inlineSize: 403, blockSize: 300 }] }] as unknown as ResizeObserverEntry[]);
            expect(mockFit).not.toHaveBeenCalled();
        });

        it('calls fit() when size changes by 4px or more (real resize)', () => {
            let cb: ((entries: ResizeObserverEntry[]) => void) | null = null;
            vi.stubGlobal('ResizeObserver', vi.fn(function MockResizeObserver(f: (entries: ResizeObserverEntry[]) => void) {
                cb = f;
                return { observe: vi.fn(), disconnect: vi.fn() };
            }));

            render(<MindmapRenderer markdown="# Topic" />);
            cb!([{ contentBoxSize: [{ inlineSize: 400, blockSize: 300 }] }] as unknown as ResizeObserverEntry[]);
            vi.clearAllMocks();

            cb!([{ contentBoxSize: [{ inlineSize: 420, blockSize: 310 }] }] as unknown as ResizeObserverEntry[]);
            expect(mockFit).toHaveBeenCalledTimes(1);
        });

        it('uses requestAnimationFrame to coalesce fit calls', () => {
            let cb: ((entries: ResizeObserverEntry[]) => void) | null = null;
            vi.stubGlobal('ResizeObserver', vi.fn(function MockResizeObserver(f: (entries: ResizeObserverEntry[]) => void) {
                cb = f;
                return { observe: vi.fn(), disconnect: vi.fn() };
            }));
            const rafSpy = vi.fn((_cb: FrameRequestCallback) => 42);
            vi.stubGlobal('requestAnimationFrame', rafSpy);

            render(<MindmapRenderer markdown="# Topic" />);
            rafSpy.mockClear();

            cb!([{ contentBoxSize: [{ inlineSize: 500, blockSize: 400 }] }] as unknown as ResizeObserverEntry[]);
            expect(rafSpy).toHaveBeenCalledTimes(1);
        });
    });

    it('disconnects ResizeObserver on unmount', () => {
        const disconnect = vi.fn();
        vi.stubGlobal(
            'ResizeObserver',
            vi.fn(function MockResizeObserver() { return { observe: vi.fn(), disconnect }; }),
        );
        const { unmount } = render(
            <MindmapRenderer markdown="# Topic" />,
        );
        unmount();
        expect(disconnect).toHaveBeenCalled();
    });
});
