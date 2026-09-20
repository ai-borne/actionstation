import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { CanvasView } from '../CanvasView';
import { useCanvasStore } from '../../stores/canvasStore';
import { useSettingsStore } from '@/shared/stores/settingsStore';
import { ReactFlow, ConnectionLineType } from '@xyflow/react';

// Mock ReactFlow component and sub-components
vi.mock('@xyflow/react', async (importOriginal) => {
    const original = await importOriginal<typeof import('@xyflow/react')>();
    return {
        ...original,
        ReactFlow: vi.fn(({ nodes, children }) => (
            <div data-testid="mock-react-flow" data-nodes={JSON.stringify(nodes)}>
                {children}
            </div>
        )),
        Background: vi.fn(() => <div data-testid="mock-background" />),
        ZoomControls: () => <div data-testid="mock-zoom-controls" />,
        useNodesState: (initialNodes: unknown[]) => [initialNodes, vi.fn(), vi.fn()],
        useEdgesState: (initialEdges: unknown[]) => [initialEdges, vi.fn(), vi.fn()],
        useStore: (selector: (s: Record<string, unknown>) => unknown) =>
            selector({ transform: [0, 0, 1] }),
        useReactFlow: () => ({ setCenter: vi.fn() }),
    };
});

// Mock ZoomControls import
vi.mock('../ZoomControls', () => ({
    ZoomControls: () => <div data-testid="mock-zoom-controls" />,
}));

// Mock FocusOverlay import
vi.mock('../FocusOverlay', () => ({
    FocusOverlay: () => <div data-testid="mock-focus-overlay" />,
}));

// Mock ViewportSync import
vi.mock('../ViewportSync', () => ({
    ViewportSync: () => null,
}));
vi.mock('@/features/subscription/hooks/useNodeCreationGuard', () => ({ useNodeCreationGuard: () => ({ guardNodeCreation: () => true }) }));
vi.mock('@/shared/contexts/TabLeaderContext', () => ({
    useTabLeaderRole: () => true,
    useTabLeaderState: () => ({ role: 'leader', isLeader: true }),
    TabLeaderProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe('CanvasView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset store
        useCanvasStore.setState({
            nodes: [
                {
                    id: 'node-1',
                    workspaceId: 'workspace-1',
                    type: 'idea',
                    data: { prompt: 'Test Node', output: undefined, isGenerating: false, isPromptCollapsed: false },
                    position: { x: 100, y: 100 },
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
            edges: [],
            selectedNodeIds: new Set(),
        });
        useSettingsStore.setState({
            isCanvasLocked: false,
            canvasScrollMode: 'zoom'
        });
    });

    it('should map store nodes to ReactFlow nodes correctly', () => {
        render(<CanvasView />);

        // Check that ReactFlow is rendered with nodes from store
        const mockFlow = document.querySelector('[data-testid="mock-react-flow"]');
        const nodes = JSON.parse(mockFlow?.getAttribute('data-nodes') || '[]');

        expect(nodes).toHaveLength(1);
        expect(nodes[0]).toMatchObject({
            id: 'node-1',
            type: 'idea',
            position: { x: 100, y: 100 },
        });
    });

    it('should configure ReactFlow with proper viewport settings', () => {
        render(<CanvasView />);

        const mockCalls = vi.mocked(ReactFlow).mock.calls;
        const reactFlowProps = mockCalls[0]?.[0] ?? {};
        // Viewport is now controlled programmatically via ViewportSync component
        expect(reactFlowProps.defaultViewport).toBeUndefined();
        // fitView is disabled to prevent auto-zoom making nodes appear oversized
        expect(reactFlowProps.fitView).toBeUndefined();
    });

    describe('Edge configuration', () => {
        beforeEach(() => {
            // Setup store with edges for edge tests
            useCanvasStore.setState({
                nodes: [
                    {
                        id: 'node-1',
                        workspaceId: 'workspace-1',
                        type: 'idea',
                        data: { prompt: 'Source Node', output: undefined, isGenerating: false, isPromptCollapsed: false },
                        position: { x: 100, y: 100 },
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                    {
                        id: 'node-2',
                        workspaceId: 'workspace-1',
                        type: 'idea',
                        data: { prompt: 'Target Node', output: undefined, isGenerating: false, isPromptCollapsed: false },
                        position: { x: 100, y: 300 },
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ],
                edges: [
                    {
                        id: 'edge-1',
                        workspaceId: 'workspace-1',
                        sourceNodeId: 'node-1',
                        targetNodeId: 'node-2',
                        relationshipType: 'derived',
                    },
                ],
                selectedNodeIds: new Set(),
            });
        });

        it('should use deletable custom edge type', () => {
            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const reactFlowProps = mockCalls[0]?.[0] ?? {};
            const edges = reactFlowProps.edges ?? [];

            expect(edges[0]).toMatchObject({
                type: 'deletable',
            });
        });

        it('should register DeletableEdge as custom edge type', () => {
            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const reactFlowProps = mockCalls[0]?.[0] ?? {};

            expect(reactFlowProps.edgeTypes).toBeDefined();
            expect(reactFlowProps.edgeTypes).toHaveProperty('deletable');
        });

        it('should use Bezier connection line type', () => {
            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const reactFlowProps = mockCalls[0]?.[0] ?? {};

            expect(reactFlowProps.connectionLineType).toBe(ConnectionLineType.Bezier);
        });

        it('should configure default edge options with deletable type', () => {
            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const reactFlowProps = mockCalls[0]?.[0] ?? {};

            expect(reactFlowProps.defaultEdgeOptions).toMatchObject({
                type: 'deletable',
            });
        });

        it('should animate edges with derived relationship type', () => {
            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const reactFlowProps = mockCalls[0]?.[0] ?? {};
            const edges = reactFlowProps.edges ?? [];

            // Edge with 'derived' relationship should be animated
            expect(edges[0]).toMatchObject({
                animated: true,
            });
        });
    });

    describe('Selection sync', () => {
        it('should pass selected=true to nodes in selectedNodeIds', () => {
            // Set a node as selected in the store
            useCanvasStore.setState({
                nodes: [
                    {
                        id: 'node-1',
                        workspaceId: 'workspace-1',
                        type: 'idea',
                        data: { prompt: 'Test Node', output: undefined, isGenerating: false, isPromptCollapsed: false },
                        position: { x: 100, y: 100 },
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                    {
                        id: 'node-2',
                        workspaceId: 'workspace-1',
                        type: 'idea',
                        data: { prompt: 'Another Node', output: undefined, isGenerating: false, isPromptCollapsed: false },
                        position: { x: 200, y: 200 },
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ],
                edges: [],
                selectedNodeIds: new Set(['node-1']), // node-1 is selected
            });

            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const reactFlowProps = mockCalls[0]?.[0] ?? {};
            const nodes = reactFlowProps.nodes ?? [];

            // node-1 should have selected=true
            const node1 = nodes.find((n: { id: string }) => n.id === 'node-1');
            expect(node1?.selected).toBe(true);

            // node-2 should have selected=false
            const node2 = nodes.find((n: { id: string }) => n.id === 'node-2');
            expect(node2?.selected).toBe(false);
        });

        it('should pass selected=false when no nodes are selected', () => {
            useCanvasStore.setState({
                nodes: [
                    {
                        id: 'node-1',
                        workspaceId: 'workspace-1',
                        type: 'idea',
                        data: { prompt: 'Test Node', output: undefined, isGenerating: false, isPromptCollapsed: false },
                        position: { x: 100, y: 100 },
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ],
                edges: [],
                selectedNodeIds: new Set(), // No selection
            });

            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const reactFlowProps = mockCalls[0]?.[0] ?? {};
            const nodes = reactFlowProps.nodes ?? [];

            expect(nodes[0]?.selected).toBe(false);
        });
    });

});
