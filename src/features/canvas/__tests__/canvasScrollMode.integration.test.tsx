/**
 * Canvas Scroll Mode Integration Test
 * Verifies settings store changes flow through to CanvasView ReactFlow props
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasView } from '../components/CanvasView';
import { useCanvasStore } from '../stores/canvasStore';
import { useSettingsStore } from '@/shared/stores/settingsStore';
import { ReactFlow } from '@xyflow/react';

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
        Controls: () => <div data-testid="mock-controls" />,
        useReactFlow: vi.fn(() => ({
            zoomIn: vi.fn(),
            zoomOut: vi.fn(),
            fitView: vi.fn(),
        })),
        useStore: (selector: (s: Record<string, unknown>) => unknown) =>
            selector({ transform: [0, 0, 1], width: 800, height: 600 }),
    };
});

vi.mock('../components/ViewportSync', () => ({
    ViewportSync: () => null,
}));
vi.mock('@/features/subscription/hooks/useNodeCreationGuard', () => ({ useNodeCreationGuard: () => ({ guardNodeCreation: () => true }) }));
vi.mock('@/shared/contexts/TabLeaderContext', () => ({
    useTabLeaderRole: () => true,
    useTabLeaderState: () => ({ role: 'leader', isLeader: true }),
    TabLeaderProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe('Canvas Scroll Mode Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useCanvasStore.setState({
            nodes: [],
            edges: [],
            selectedNodeIds: new Set(),
        });
        useSettingsStore.setState({
            canvasScrollMode: 'zoom',
            canvasGrid: true,
        });
    });

    it('should pass zoom props when store has zoom mode', () => {
        render(<CanvasView />);

        const props = vi.mocked(ReactFlow).mock.calls[0]?.[0] ?? {};
        expect(props.zoomOnScroll).toBe(true);
        expect(props.panOnScroll).toBe(false);
    });

    it('should pass navigate props when store has navigate mode', () => {
        useSettingsStore.setState({ canvasScrollMode: 'navigate' });
        render(<CanvasView />);

        const props = vi.mocked(ReactFlow).mock.calls[0]?.[0] ?? {};
        expect(props.zoomOnScroll).toBe(false);
        expect(props.panOnScroll).toBe(true);
    });

    it('should show grid when canvasGrid setting is true', () => {
        useSettingsStore.setState({ canvasGrid: true });
        render(<CanvasView />);
        expect(screen.getByTestId('mock-background')).toBeInTheDocument();
    });

    it('should hide grid when canvasGrid setting is false', () => {
        useSettingsStore.setState({ canvasGrid: false });
        render(<CanvasView />);
        expect(screen.queryByTestId('mock-background')).not.toBeInTheDocument();
    });
});
