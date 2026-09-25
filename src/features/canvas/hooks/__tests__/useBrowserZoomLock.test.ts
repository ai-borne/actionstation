/**
 * useBrowserZoomLock — TDD tests.
 *
 * The bug: pinch-to-zoom on the canvas sometimes zooms the entire browser UI
 * (sidebar, toolbar, everything) instead of only the ReactFlow canvas.
 *
 * Root cause: the browser's native pinch-zoom is NOT suppressed.
 *  - On Chrome/Firefox trackpads, pinch fires `wheel` events with `ctrlKey: true`.
 *  - On Safari, pinch fires `gesturestart` / `gesturechange` events.
 *  - Neither is intercepted at the document level, so the browser compositor
 *    races ReactFlow and sometimes wins, scaling the entire viewport.
 *
 * The hook should attach document-level listeners that `preventDefault()` on
 * these events so only ReactFlow's internal zoom handler controls the canvas.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBrowserZoomLock } from '../useBrowserZoomLock';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Dispatch a wheel event on document with given options. */
function fireWheelEvent(opts: WheelEventInit & { ctrlKey?: boolean } = {}): WheelEvent {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...opts });
    document.dispatchEvent(event);
    return event;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('useBrowserZoomLock', () => {
    let addSpy: MockInstance<typeof document.addEventListener>;
    let removeSpy: MockInstance<typeof document.removeEventListener>;

    beforeEach(() => {
        addSpy = vi.spyOn(document, 'addEventListener');
        removeSpy = vi.spyOn(document, 'removeEventListener');
    });

    afterEach(() => {
        addSpy.mockRestore();
        removeSpy.mockRestore();
    });

    /* ----- Listener registration ---------------------------------- */

    it('registers a wheel listener on document on mount', () => {
        renderHook(() => useBrowserZoomLock());
        const wheelCalls = addSpy.mock.calls.filter(([type]) => type === 'wheel');
        expect(wheelCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('registers wheel listener as non-passive so preventDefault works', () => {
        renderHook(() => useBrowserZoomLock());
        const wheelCall = addSpy.mock.calls.find(([type]) => type === 'wheel');
        expect(wheelCall).toBeDefined();
        const options = wheelCall![2] as AddEventListenerOptions;
        expect(options.passive).toBe(false);
    });

    // ── REGRESSION: capture-phase guard ─────────────────────────────────────
    // Bug: wheel listener was registered in the bubble phase.  A card's
    // content-scroll handler calls e.stopPropagation(), which prevented the
    // document listener from ever firing.  The browser's native zoom then won
    // the race and scaled the entire viewport instead of just the canvas.
    // Fix: register on the CAPTURE phase (capture: true) so the listener fires
    // before any child handler can suppress propagation.

    it('registers wheel listener in capture phase (stopPropagation regression)', () => {
        renderHook(() => useBrowserZoomLock());
        const wheelCall = addSpy.mock.calls.find(([type]) => type === 'wheel');
        expect(wheelCall).toBeDefined();
        const options = wheelCall![2] as AddEventListenerOptions;
        expect(options.capture).toBe(true);
    });

    it('registers gesturestart listener in capture phase', () => {
        renderHook(() => useBrowserZoomLock());
        const call = addSpy.mock.calls.find(([type]) => type === 'gesturestart');
        expect(call).toBeDefined();
        const options = call![2] as AddEventListenerOptions;
        expect(options.capture).toBe(true);
    });

    it('registers gesturechange listener in capture phase', () => {
        renderHook(() => useBrowserZoomLock());
        const call = addSpy.mock.calls.find(([type]) => type === 'gesturechange');
        expect(call).toBeDefined();
        const options = call![2] as AddEventListenerOptions;
        expect(options.capture).toBe(true);
    });

    it('registers gesturestart listener on document (Safari pinch)', () => {
        renderHook(() => useBrowserZoomLock());
        const calls = addSpy.mock.calls.filter(([type]) => type === 'gesturestart');
        expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    it('registers gesturechange listener on document (Safari pinch)', () => {
        renderHook(() => useBrowserZoomLock());
        const calls = addSpy.mock.calls.filter(([type]) => type === 'gesturechange');
        expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    /* ----- Ctrl+wheel prevention ---------------------------------- */

    it('calls preventDefault on wheel events with ctrlKey (trackpad pinch)', () => {
        renderHook(() => useBrowserZoomLock());
        const event = fireWheelEvent({ ctrlKey: true, deltaY: -100 });
        expect(event.defaultPrevented).toBe(true);
    });

    // ── KEY REGRESSION TEST ─────────────────────────────────────────────────
    // Reproduces the original bug:  a child element (e.g. IdeaCard content
    // scroll area) calls e.stopPropagation() on the wheel event, which
    // previously prevented the document bubble-phase listener from ever firing.
    // With capture: true the document listener runs BEFORE the child's handler,
    // so preventDefault() is always called on ctrlKey wheel events regardless
    // of what child handlers do.
    it('calls preventDefault on ctrlKey wheel even when a child calls stopPropagation (capture-phase regression)', () => {
        renderHook(() => useBrowserZoomLock());

        // Simulate a child element that calls stopPropagation() — just like
        // useIdeaCardActions does on card content scroll areas.
        const child = document.createElement('div');
        document.body.appendChild(child);
        child.addEventListener('wheel', (e) => e.stopPropagation());

        const event = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: -100,
        });
        child.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);

        document.body.removeChild(child);
    });

    it('does NOT preventDefault on child ctrlKey wheel that stops propagation when unmounted', () => {
        const { unmount } = renderHook(() => useBrowserZoomLock());
        unmount();

        const child = document.createElement('div');
        document.body.appendChild(child);
        child.addEventListener('wheel', (e) => e.stopPropagation());

        const event = new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            deltaY: -100,
        });
        child.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);

        document.body.removeChild(child);
    });

    it('does NOT call preventDefault on normal wheel events (no ctrlKey)', () => {
        renderHook(() => useBrowserZoomLock());
        const event = fireWheelEvent({ ctrlKey: false, deltaY: -100 });
        expect(event.defaultPrevented).toBe(false);
    });

    it('does NOT call preventDefault on wheel events with metaKey only', () => {
        renderHook(() => useBrowserZoomLock());
        const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, metaKey: true, deltaY: -100 });
        document.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
    });

    /* ----- Gesture event prevention (Safari) ---------------------- */

    it('calls preventDefault on gesturestart events', () => {
        renderHook(() => useBrowserZoomLock());
        const event = new Event('gesturestart', { bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it('calls preventDefault on gesturechange events', () => {
        renderHook(() => useBrowserZoomLock());
        const event = new Event('gesturechange', { bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    /* ----- Cleanup ------------------------------------------------ */

    it('removes all listeners on unmount', () => {
        const { unmount } = renderHook(() => useBrowserZoomLock());
        unmount();

        const removedTypes = removeSpy.mock.calls.map(([type]) => type);
        expect(removedTypes).toContain('wheel');
        expect(removedTypes).toContain('gesturestart');
        expect(removedTypes).toContain('gesturechange');
    });

    it('does NOT call preventDefault after unmount', () => {
        const { unmount } = renderHook(() => useBrowserZoomLock());
        unmount();

        const event = fireWheelEvent({ ctrlKey: true, deltaY: -100 });
        expect(event.defaultPrevented).toBe(false);
    });
});
