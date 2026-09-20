import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasView } from '../CanvasView';
import { useCanvasStore } from '../../stores/canvasStore';
import { useFocusStore } from '../../stores/focusStore';
import { useSettingsStore } from '@/shared/stores/settingsStore';
import { ReactFlow } from '@xyflow/react';

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

vi.mock('../ZoomControls', () => ({
    ZoomControls: () => <div data-testid="mock-zoom-controls" />,
}));

vi.mock('../FocusOverlay', () => ({
    FocusOverlay: () => <div data-testid="mock-focus-overlay" />,
}));

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

    describe('Canvas scroll mode', () => {
        it('should set zoomOnScroll=true when scroll mode is zoom', () => {
            useSettingsStore.setState({ canvasScrollMode: 'zoom' });
            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const props = mockCalls[0]?.[0] ?? {};
            expect(props.zoomOnScroll).toBe(true);
            expect(props.panOnScroll).toBe(false);
        });

        it('should set panOnScroll=true when scroll mode is navigate', () => {
            useSettingsStore.setState({ canvasScrollMode: 'navigate' });
            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const props = mockCalls[0]?.[0] ?? {};
            expect(props.zoomOnScroll).toBe(false);
            expect(props.panOnScroll).toBe(true);
        });
    });

    describe('Pin prevents drag via noDragClassName', () => {
        it('passes noDragClassName prop to ReactFlow', () => {
            render(<CanvasView />);
            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const props = mockCalls[0]?.[0] ?? {};
            expect(props.noDragClassName).toBe('nodrag');
        });

        it('RF node objects never include per-node draggable', () => {
            useCanvasStore.setState({
                nodes: [
                    {
                        id: 'pinned-node',
                        workspaceId: 'workspace-1',
                        type: 'idea',
                        data: { prompt: 'Pinned', output: undefined, isGenerating: false, isPromptCollapsed: false, isPinned: true, isCollapsed: false },
                        position: { x: 50, y: 50 },
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ],
                edges: [],
                selectedNodeIds: new Set(),
            });

            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const props = mockCalls[0]?.[0] ?? {};
            const nodes = props.nodes ?? [];
            expect(nodes[0]).not.toHaveProperty('draggable');
        });
    });

    describe('Canvas grid wiring', () => {
        it('should render Background when canvasGrid is true', () => {
            useSettingsStore.setState({ canvasGrid: true });
            render(<CanvasView />);
            expect(screen.getByTestId('mock-background')).toBeInTheDocument();
        });

        it('should not render Background when canvasGrid is false', () => {
            useSettingsStore.setState({ canvasGrid: false });
            render(<CanvasView />);
            expect(screen.queryByTestId('mock-background')).not.toBeInTheDocument();
        });
    });

    describe('Locked Canvas', () => {
        beforeEach(() => {
            useSettingsStore.setState({ isCanvasLocked: true });
        });

        it('should disable interactions when locked', () => {
            render(<CanvasView />);
            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const props = mockCalls[0]?.[0] ?? {};

            expect(props.nodesDraggable).toBe(false);
            // elementsSelectable stays true when locked so nodes can be clicked
            // to select them (enabling the F key and context-menu Focus action).
            // Only focus mode (FocusOverlay) sets it false.
            expect(props.elementsSelectable).toBe(true);
            // rubber-band drag-select is still blocked (selectionOnDrag=false)
            expect(props.selectionOnDrag).toBe(false);
            expect(props.nodesConnectable).toBe(false);
            expect(props.panOnDrag).toBe(false);
            expect(props.zoomOnScroll).toBe(false);
            expect(props.panOnScroll).toBe(false);
        });

        it('global nodesDraggable handles lock, per-node draggable not used', () => {
            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const props = mockCalls[0]?.[0] ?? {};

            expect(props.nodesDraggable).toBe(false);
            expect(props.noDragClassName).toBe('nodrag');
        });

        it('should render ZoomControls', () => {
            render(<CanvasView />);
            expect(screen.getByTestId('mock-zoom-controls')).toBeInTheDocument();
        });
    });

    describe('Focus mode integration', () => {
        beforeEach(() => {
            useFocusStore.setState({ focusedNodeId: null });
        });

        it('should render FocusOverlay component', () => {
            render(<CanvasView />);
            expect(screen.getByTestId('mock-focus-overlay')).toBeInTheDocument();
        });

        it('should disable canvas interactions when a node is focused', () => {
            useFocusStore.setState({ focusedNodeId: 'node-1' });
            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const props = mockCalls[0]?.[0] ?? {};

            expect(props.nodesDraggable).toBe(false);
            expect(props.elementsSelectable).toBe(false);
            expect(props.nodesConnectable).toBe(false);
            expect(props.panOnDrag).toBe(false);
            expect(props.zoomOnScroll).toBe(false);
            expect(props.panOnScroll).toBe(false);
        });

        it('should not disable canvas interactions when no node is focused', () => {
            useFocusStore.setState({ focusedNodeId: null });
            render(<CanvasView />);

            const mockCalls = vi.mocked(ReactFlow).mock.calls;
            const props = mockCalls[0]?.[0] ?? {};

            expect(props.nodesDraggable).toBe(true);
            expect(props.elementsSelectable).toBe(true);
            expect(props.nodesConnectable).toBe(true);
            expect(props.panOnDrag).toEqual([1, 2]);
        });
    });
});
