/**
 * useDoubleClickToCreate — Integration tests.
 *
 * Verifies the hook creates a node at the correct position on pane double-click,
 * respects guard conditions, and dispatches focus events.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDoubleClickToCreate } from '../useDoubleClickToCreate';
import { useCanvasStore } from '../../stores/canvasStore';
import { useSettingsStore } from '@/shared/stores/settingsStore';
import { FOCUS_NODE_EVENT } from '../useQuickCapture';

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockWorkspaceId: string | null = 'test-workspace';
vi.mock('@/app/contexts/WorkspaceContext', () => ({
    useWorkspaceContext: () => ({ currentWorkspaceId: mockWorkspaceId, isSwitching: false }),
}));

vi.mock('../usePanToNode', () => ({
    usePanToNode: () => ({
        panToPosition: vi.fn(),
    }),
}));

const mockScreenToFlowPosition = vi.fn((pos: { x: number; y: number }) => pos);
vi.mock('@xyflow/react', async (importOriginal) => {
    const original = await importOriginal<typeof import('@xyflow/react')>();
    return {
        ...original,
        useReactFlow: () => ({
            screenToFlowPosition: mockScreenToFlowPosition,
            zoomIn: vi.fn(),
            zoomOut: vi.fn(),
            fitView: vi.fn(),
        }),
    };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDblClickEvent(clientX: number, clientY: number, targetClass = 'react-flow__pane'): React.MouseEvent {
    const target = document.createElement('div');
    target.classList.add(targetClass);
    return {
        clientX,
        clientY,
        target,
        preventDefault: vi.fn(),
    } as unknown as React.MouseEvent;
}

// ── Tests ────────────────────────────────────────────────────────────────────

vi.mock('@/features/subscription/hooks/useNodeCreationGuard', () => ({ useNodeCreationGuard: () => ({ guardNodeCreation: () => true }) }));

describe('useDoubleClickToCreate', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockWorkspaceId = 'test-workspace';
        mockScreenToFlowPosition.mockImplementation((pos) => pos);
        useCanvasStore.setState({
            nodes: [],
            edges: [],
            selectedNodeIds: new Set(),
            editingNodeId: null,
        });
        useSettingsStore.setState({ isCanvasLocked: false, canvasFreeFlow: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('creates a node at double-click position', () => {
        const { result } = renderHook(() => useDoubleClickToCreate());

        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(400, 300));
        });

        const nodes = useCanvasStore.getState().nodes;
        expect(nodes).toHaveLength(1);
        expect(nodes[0]?.position).toEqual({ x: 400, y: 300 });
    });

    it('converts screen coordinates via screenToFlowPosition', () => {
        mockScreenToFlowPosition.mockImplementation(({ x, y }) => ({
            x: x * 2,
            y: y * 2,
        }));

        const { result } = renderHook(() => useDoubleClickToCreate());

        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(100, 50));
        });

        expect(mockScreenToFlowPosition).toHaveBeenCalledWith({ x: 100, y: 50 });
        const nodes = useCanvasStore.getState().nodes;
        expect(nodes[0]?.position).toEqual({ x: 200, y: 100 });
    });

    it('dispatches FOCUS_NODE_EVENT after 50ms', () => {
        const listener = vi.fn();
        window.addEventListener(FOCUS_NODE_EVENT, listener);

        const { result } = renderHook(() => useDoubleClickToCreate());
        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(100, 100));
        });

        // Not yet dispatched
        expect(listener).not.toHaveBeenCalled();

        // Advance past the 50ms focus delay
        act(() => {
            vi.advanceTimersByTime(50);
        });

        expect(listener).toHaveBeenCalledTimes(1);
        const detail = (listener.mock.calls[0]![0] as CustomEvent).detail;
        expect(detail).toHaveProperty('nodeId');
        expect(typeof detail.nodeId).toBe('string');

        window.removeEventListener(FOCUS_NODE_EVENT, listener);
    });

    it('does NOT create node when canvas is locked', () => {
        useSettingsStore.setState({ isCanvasLocked: true });

        const { result } = renderHook(() => useDoubleClickToCreate());
        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(100, 100));
        });

        expect(useCanvasStore.getState().nodes).toHaveLength(0);
    });

    it('does NOT create node when click target is not the pane', () => {
        const { result } = renderHook(() => useDoubleClickToCreate());
        const nonPaneEvent = makeDblClickEvent(100, 100, 'react-flow__node');

        act(() => {
            result.current.onDoubleClick(nonPaneEvent);
        });

        expect(useCanvasStore.getState().nodes).toHaveLength(0);
    });

    it('does NOT create node without a workspace', () => {
        mockWorkspaceId = null;

        const { result } = renderHook(() => useDoubleClickToCreate());
        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(100, 100));
        });

        expect(useCanvasStore.getState().nodes).toHaveLength(0);
    });

    it('prevents rapid-fire creation (debounce)', () => {
        const { result } = renderHook(() => useDoubleClickToCreate());

        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(100, 100));
        });

        // Immediate second double-click should be rejected
        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(200, 200));
        });

        expect(useCanvasStore.getState().nodes).toHaveLength(1);
        expect(useCanvasStore.getState().nodes[0]?.position).toEqual({ x: 100, y: 100 });
    });

    it('uses masonry snap in grid mode', () => {
        useSettingsStore.setState({ canvasFreeFlow: false });

        const { result } = renderHook(() => useDoubleClickToCreate());
        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(50, 100));
        });

        const nodes = useCanvasStore.getState().nodes;
        expect(nodes).toHaveLength(1);
        // In masonry mode, x should snap to grid column (32 for col 0)
        expect(nodes[0]?.position.x).toBe(32);
    });

    describe('rAF race condition guard (stale editingNodeId)', () => {
        it('creates node on pane double-click even when editingNodeId is stale', () => {
            // Simulates the window between onHeadingBlur firing and the rAF callback
            // running: editingNodeId is still set, but focus has moved to the pane.
            // The pane class check is the correct spatial guard — editingNodeId must
            // not veto the creation when the user has clearly navigated to the pane.
            useCanvasStore.setState({
                editingNodeId: 'node-being-left',
                nodes: [], edges: [], selectedNodeIds: new Set(),
            });

            const { result } = renderHook(() => useDoubleClickToCreate());
            act(() => {
                result.current.onDoubleClick(makeDblClickEvent(200, 200));
            });

            expect(useCanvasStore.getState().nodes).toHaveLength(1);
        });

        it('clears stale editingNodeId synchronously on pane double-click', () => {
            // createNodeAtScreen must call stopEditing() before creating so the
            // rAF-deferred stopEditing in onHeadingBlur is pre-empted.
            useCanvasStore.setState({
                editingNodeId: 'node-being-left',
                nodes: [], edges: [], selectedNodeIds: new Set(),
            });

            const { result } = renderHook(() => useDoubleClickToCreate());
            act(() => {
                result.current.onDoubleClick(makeDblClickEvent(200, 200));
            });

            expect(useCanvasStore.getState().editingNodeId).toBeNull();
        });
    });

    it('cleans up focus timer on unmount', () => {
        const listener = vi.fn();
        window.addEventListener(FOCUS_NODE_EVENT, listener);

        const { result, unmount } = renderHook(() => useDoubleClickToCreate());
        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(100, 100));
        });

        // Unmount before timer fires
        unmount();

        act(() => {
            vi.advanceTimersByTime(100);
        });

        // Focus event should NOT fire after unmount
        expect(listener).not.toHaveBeenCalled();

        window.removeEventListener(FOCUS_NODE_EVENT, listener);
    });
});
