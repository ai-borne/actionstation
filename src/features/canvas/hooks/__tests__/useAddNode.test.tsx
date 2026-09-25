/**
 * useAddNode Hook Tests - Single source of truth for node creation
 * Verifies grid positioning, pan behavior, AddNodeOptions API, and return value
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAddNode } from '../useAddNode';
import { useCanvasStore } from '../../stores/canvasStore';

let mockWorkspaceId: string | null = 'test-workspace';
let mockIsLoading = false;
vi.mock('@/app/contexts/WorkspaceContext', () => ({
    useWorkspaceContext: () => ({ currentWorkspaceId: mockWorkspaceId, isSwitching: false, isLoading: mockIsLoading }),
}));

vi.mock('../usePanToNode', () => ({
    usePanToNode: () => ({
        panToPosition: vi.fn(),
    }),
}));

const mockTrackNodeCreated = vi.fn();
vi.mock('@/shared/services/analyticsService', () => ({
    trackNodeCreated: (...args: unknown[]) => mockTrackNodeCreated(...args),
}));

vi.mock('@/features/subscription/hooks/useNodeCreationGuard', () => ({
    useNodeCreationGuard: () => ({ guardNodeCreation: () => true }),
}));

describe('useAddNode', () => {
    beforeEach(() => {
        useCanvasStore.setState({ nodes: [], edges: [], selectedNodeIds: new Set() });
        mockWorkspaceId = 'test-workspace';
        mockIsLoading = false;
        mockTrackNodeCreated.mockClear();
    });

    it('creates nothing while the workspace is still loading (the load would replace it)', () => {
        mockIsLoading = true;
        const { result } = renderHook(() => useAddNode());

        let id: string | undefined;
        act(() => { id = result.current(); });

        expect(id).toBeUndefined();
        expect(useCanvasStore.getState().nodes).toHaveLength(0);
        expect(mockTrackNodeCreated).not.toHaveBeenCalled();
    });

    it('should add a new node to the canvas', () => {
        const { result } = renderHook(() => useAddNode());

        act(() => {
            result.current();
        });

        const nodes = useCanvasStore.getState().nodes;
        expect(nodes).toHaveLength(1);
        const firstNode = nodes[0];
        expect(firstNode).toBeDefined();
        expect(firstNode?.type).toBe('idea');
    });

    it('should position node at next grid position (0,0 for first node)', () => {
        const { result } = renderHook(() => useAddNode());

        act(() => {
            result.current();
        });

        const nodes = useCanvasStore.getState().nodes;
        const firstNode = nodes[0];
        expect(firstNode).toBeDefined();
        // First node should be at origin (32,32) in grid
        expect(firstNode?.position).toEqual({ x: 32, y: 32 });
    });

    it('should position second node at next grid column', () => {
        // Pre-add first node
        useCanvasStore.getState().addNode({
            id: 'existing-node',
            workspaceId: 'test-workspace',
            type: 'idea',
            position: { x: 0, y: 0 },
            data: { prompt: '', output: '' },
            width: 280,
            height: 220,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const { result } = renderHook(() => useAddNode());

        act(() => {
            result.current();
        });

        const nodes = useCanvasStore.getState().nodes;
        const secondNode = nodes[1];
        expect(secondNode).toBeDefined();
        // Second node should be in next grid column (x > 32)
        expect(secondNode?.position.x).toBeGreaterThan(32);
        expect(secondNode?.position.y).toBe(32);
    });

    it('should use current workspace ID', () => {
        mockWorkspaceId = 'my-workspace';
        const { result } = renderHook(() => useAddNode());

        act(() => {
            result.current();
        });

        const nodes = useCanvasStore.getState().nodes;
        const firstNode = nodes[0];
        expect(firstNode).toBeDefined();
        expect(firstNode?.workspaceId).toBe('my-workspace');
    });

    it('should create node with unique ID', async () => {
        const { result } = renderHook(() => useAddNode());

        act(() => {
            result.current();
        });

        // Small delay to ensure different timestamp
        await new Promise((resolve) => setTimeout(resolve, 2));

        act(() => {
            result.current();
        });

        const nodes = useCanvasStore.getState().nodes;
        expect(nodes).toHaveLength(2);
        const firstNode = nodes[0];
        const secondNode = nodes[1];
        expect(firstNode).toBeDefined();
        expect(secondNode).toBeDefined();
        expect(firstNode?.id).not.toBe(secondNode?.id);
    });

    it('should not add node if no workspace is selected', () => {
        mockWorkspaceId = null;
        const { result } = renderHook(() => useAddNode());

        act(() => {
            result.current();
        });

        const nodes = useCanvasStore.getState().nodes;
        expect(nodes).toHaveLength(0);
    });

    it('should create node with proper IdeaCard data structure', () => {
        const { result } = renderHook(() => useAddNode());

        act(() => {
            result.current();
        });

        const nodes = useCanvasStore.getState().nodes;
        const node = nodes[0];
        expect(node?.data).toEqual({
            heading: '',
            output: undefined,
            isGenerating: false,
            isPromptCollapsed: false,
            isPinned: false,
            isCollapsed: false,
            colorKey: 'default',
        });
        expect(node?.width).toBe(280); // DEFAULT_NODE_WIDTH
        expect(node?.height).toBe(220); // DEFAULT_NODE_HEIGHT
    });

    describe('positionOverride', () => {
        it('uses override position instead of auto-calculated position', () => {
            const { result } = renderHook(() => useAddNode());

            act(() => {
                result.current({ x: 500, y: 700 });
            });

            const nodes = useCanvasStore.getState().nodes;
            expect(nodes).toHaveLength(1);
            expect(nodes[0]?.position).toEqual({ x: 500, y: 700 });
        });

        it('ignores auto-positioning when override is provided', () => {
            // Pre-add a node so auto-position would NOT be at (500,700)
            useCanvasStore.getState().addNode({
                id: 'existing-node',
                workspaceId: 'test-workspace',
                type: 'idea',
                position: { x: 0, y: 0 },
                data: { prompt: '', output: '' },
                width: 280,
                height: 220,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const { result } = renderHook(() => useAddNode());

            act(() => {
                result.current({ x: 500, y: 700 });
            });

            const nodes = useCanvasStore.getState().nodes;
            const newNode = nodes[1];
            expect(newNode?.position).toEqual({ x: 500, y: 700 });
        });

        it('falls back to auto-position when no override is provided', () => {
            const { result } = renderHook(() => useAddNode());

            act(() => {
                result.current();
            });

            const nodes = useCanvasStore.getState().nodes;
            // Default auto-position for first node is GRID_PADDING
            expect(nodes[0]?.position).toEqual({ x: 32, y: 32 });
        });

        it('rejects React events passed as positionOverride (onClick={handleAddNode})', () => {
            const { result } = renderHook(() => useAddNode());

            // Simulate onClick={handleAddNode} where React passes event as first arg
            const fakeEvent = { x: 100, y: 200, nativeEvent: new MouseEvent('click') };
            act(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                result.current(fakeEvent as any);
            });

            const nodes = useCanvasStore.getState().nodes;
            expect(nodes).toHaveLength(1);
            // Should fall back to auto-position, NOT use the event coordinates
            expect(nodes[0]?.position).toEqual({ x: 32, y: 32 });
        });
    });

    describe('AddNodeOptions API', () => {
        it('accepts AddNodeOptions with position and source', () => {
            const { result } = renderHook(() => useAddNode());

            act(() => {
                result.current({ position: { x: 300, y: 400 }, source: 'canvas-double-click' });
            });

            const nodes = useCanvasStore.getState().nodes;
            expect(nodes).toHaveLength(1);
            expect(nodes[0]?.position).toEqual({ x: 300, y: 400 });
            expect(mockTrackNodeCreated).toHaveBeenCalledWith('canvas-double-click');
        });

        it('defaults analytics source to idea when not specified', () => {
            const { result } = renderHook(() => useAddNode());

            act(() => {
                result.current();
            });

            expect(mockTrackNodeCreated).toHaveBeenCalledWith('idea');
        });

        it('fires exactly ONE analytics event per node creation', () => {
            const { result } = renderHook(() => useAddNode());

            act(() => {
                result.current({ position: { x: 100, y: 100 }, source: 'canvas-double-click' });
            });

            expect(mockTrackNodeCreated).toHaveBeenCalledTimes(1);
        });
    });

    describe('return value', () => {
        it('returns the new node ID', () => {
            const { result } = renderHook(() => useAddNode());
            let nodeId: string | undefined;

            act(() => {
                nodeId = result.current();
            });

            expect(nodeId).toBeDefined();
            expect(typeof nodeId).toBe('string');
            expect(nodeId).toMatch(/^idea-/);
            // The returned ID should match the node in the store
            expect(useCanvasStore.getState().nodes[0]?.id).toBe(nodeId);
        });

        it('returns undefined when no workspace', () => {
            mockWorkspaceId = null;
            const { result } = renderHook(() => useAddNode());
            let nodeId: string | undefined;

            act(() => {
                nodeId = result.current();
            });

            expect(nodeId).toBeUndefined();
        });
    });
});
