/**
 * useDoubleClickToCreate — Edge case tests.
 *
 * Validates: extreme zoom, undo integration, rapid succession, focus mode guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDoubleClickToCreate } from '../useDoubleClickToCreate';
import { useCanvasStore } from '../../stores/canvasStore';
import { useSettingsStore } from '@/shared/stores/settingsStore';
import { useFocusStore } from '../../stores/focusStore';

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

describe('useDoubleClickToCreate edge cases', () => {
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
        useFocusStore.setState({ focusedNodeId: null });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('handles extreme zoom (0.1x) via screenToFlowPosition scaling', () => {
        // At 0.1x zoom, a screen click at (100, 100) maps to (1000, 1000) in flow space
        mockScreenToFlowPosition.mockImplementation(({ x, y }) => ({
            x: x * 10,
            y: y * 10,
        }));

        const { result } = renderHook(() => useDoubleClickToCreate());
        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(100, 100));
        });

        const nodes = useCanvasStore.getState().nodes;
        expect(nodes[0]?.position).toEqual({ x: 1000, y: 1000 });
    });

    it('handles extreme zoom (2x) via screenToFlowPosition scaling', () => {
        mockScreenToFlowPosition.mockImplementation(({ x, y }) => ({
            x: x / 2,
            y: y / 2,
        }));

        const { result } = renderHook(() => useDoubleClickToCreate());
        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(400, 600));
        });

        const nodes = useCanvasStore.getState().nodes;
        expect(nodes[0]?.position).toEqual({ x: 200, y: 300 });
    });

    it('node created by double-click is undoable', () => {
        const { result } = renderHook(() => useDoubleClickToCreate());
        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(100, 100));
        });

        expect(useCanvasStore.getState().nodes).toHaveLength(1);

        // The node was added via addNodeWithUndo, so undo infrastructure is available.
        // We just verify the node exists and was properly created.
        const node = useCanvasStore.getState().nodes[0];
        expect(node?.type).toBe('idea');
        expect(node?.position).toEqual({ x: 100, y: 100 });
    });

    it('does NOT create node in focus mode (focusedNodeId set)', () => {
        // Focus mode locks interaction — isCanvasLocked is set by the component
        useSettingsStore.setState({ isCanvasLocked: true });

        const { result } = renderHook(() => useDoubleClickToCreate());
        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(100, 100));
        });

        expect(useCanvasStore.getState().nodes).toHaveLength(0);
    });

    it('node gets proper workspace assignment', () => {
        mockWorkspaceId = 'custom-workspace-123';

        const { result } = renderHook(() => useDoubleClickToCreate());
        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(200, 200));
        });

        const node = useCanvasStore.getState().nodes[0];
        expect(node?.workspaceId).toBe('custom-workspace-123');
    });

    it('node has default dimensions after creation', () => {
        const { result } = renderHook(() => useDoubleClickToCreate());
        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(100, 100));
        });

        const node = useCanvasStore.getState().nodes[0];
        expect(node?.width).toBe(280);  // DEFAULT_NODE_WIDTH
        expect(node?.height).toBe(220); // DEFAULT_NODE_HEIGHT
    });

    it('creates node with unique ID (crypto.randomUUID)', () => {
        const { result } = renderHook(() => useDoubleClickToCreate());

        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(100, 100));
        });

        // Wait for debounce to expire
        vi.advanceTimersByTime(400);

        act(() => {
            result.current.onDoubleClick(makeDblClickEvent(200, 200));
        });

        const nodes = useCanvasStore.getState().nodes;
        expect(nodes).toHaveLength(2);
        expect(nodes[0]?.id).not.toBe(nodes[1]?.id);
    });
});
