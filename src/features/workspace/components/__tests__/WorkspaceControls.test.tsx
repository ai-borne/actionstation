/**
 * WorkspaceControls Tests - Add Node, Arrange, Free Flow, Clear Canvas
 * Delete Workspace tests are in WorkspaceControls.delete.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceControls } from '../WorkspaceControls';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';
import { useSettingsStore } from '@/shared/stores/settingsStore';
import type { CanvasNode } from '@/features/canvas/types/node';
import { strings } from '@/shared/localization/strings';

vi.mock('../../services/workspaceService', () => ({
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
}));

const mockWorkspaceCtx = { currentWorkspaceId: 'workspace-1' as string | null, isSwitching: false, isLoading: false };
vi.mock('@/app/contexts/WorkspaceContext', () => ({
    useWorkspaceContext: () => mockWorkspaceCtx,
}));

// Mock useConfirm — initially returns false (cancel), can be overridden per test
const mockConfirm = vi.fn().mockResolvedValue(false);
vi.mock('@/shared/stores/confirmStore', () => ({
    useConfirm: () => mockConfirm,
    useConfirmStore: vi.fn(),
}));

// Mock usePanToNode
const mockPanToPosition = vi.fn();
vi.mock('@/features/canvas/hooks/usePanToNode', () => ({
    usePanToNode: () => ({
        panToPosition: mockPanToPosition,
    }),
}));

// Mock toast store — vi.hoisted ensures fns are available at vi.mock hoist time
const { mockToastSuccess, mockToastInfo, mockToastWithAction } = vi.hoisted(() => ({
    mockToastSuccess: vi.fn(),
    mockToastInfo: vi.fn(),
    mockToastWithAction: vi.fn(),
}));
vi.mock('@/shared/stores/toastStore', () => ({
    toast: {
        success: mockToastSuccess,
        error: vi.fn(),
        info: mockToastInfo,
    },
    toastWithAction: mockToastWithAction,
}));
vi.mock('@/features/subscription/hooks/useNodeCreationGuard', () => ({ useNodeCreationGuard: () => ({ guardNodeCreation: () => true }) }));

describe('WorkspaceControls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockWorkspaceCtx.isLoading = false;

        // Reset auth store
        useAuthStore.setState({
            user: {
                id: 'test-user-id',
                email: 'test@example.com',
                name: 'Test User',
                avatarUrl: '',
                createdAt: new Date(),
            },
            isAuthenticated: true,
            isLoading: false,
            error: null,
        });

        // Reset workspace store
        useWorkspaceStore.setState({
            currentWorkspaceId: 'workspace-1',
            workspaces: [
                {
                    id: 'workspace-1',
                    userId: 'test-user-id',
                    name: 'Test Workspace',
                    canvasSettings: { backgroundColor: 'grid' },
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
            isLoading: false,
            isSwitching: false,
        });

        // Reset canvas store
        useCanvasStore.setState({
            nodes: [],
            edges: [],
            selectedNodeIds: new Set(),
        });

        // Reset settings store
        useSettingsStore.setState({ canvasFreeFlow: false });

        mockConfirm.mockResolvedValue(false);
        mockWorkspaceCtx.currentWorkspaceId = 'workspace-1';
    });

    describe('rendering', () => {
        it('disables the add-node button while the workspace is loading', () => {
        mockWorkspaceCtx.isLoading = true;
        render(<WorkspaceControls />);
        expect(screen.getByTestId('add-node-button')).toBeDisabled();
    });

    it('enables the add-node button once the workspace has loaded', () => {
        render(<WorkspaceControls />);
        expect(screen.getByTestId('add-node-button')).toBeEnabled();
    });

    it('should render all action buttons', () => {
            render(<WorkspaceControls />);

            expect(screen.getByTitle(strings.workspace.addNodeTooltip)).toBeInTheDocument();
            expect(screen.getByTitle(strings.workspace.arrangeNodesTooltip)).toBeInTheDocument();
            expect(screen.getByTitle(strings.workspace.freeFlowTooltip)).toBeInTheDocument();
            expect(screen.getByTitle(strings.canvas.clearCanvas)).toBeInTheDocument();
            expect(screen.getByTitle(strings.workspace.deleteWorkspaceTooltip)).toBeInTheDocument();
        });

        it('should render dividers between buttons', () => {
            const { container } = render(<WorkspaceControls />);

            const dividers = container.querySelectorAll('[class*="w-px"]');
            expect(dividers.length).toBe(6);
        });
    });

    describe('Add Node button', () => {
        it('should add a node when clicked', () => {
            render(<WorkspaceControls />);

            const addButton = screen.getByTitle(strings.workspace.addNodeTooltip);
            fireEvent.click(addButton);

            const { nodes } = useCanvasStore.getState();
            expect(nodes).toHaveLength(1);
            expect(nodes[0]).toMatchObject({
                workspaceId: 'workspace-1',
                type: 'idea',
                width: 280,
                height: 220,
            });
            // Position is now dynamic, so we check that it called pan
            expect(mockPanToPosition).toHaveBeenCalled();
        });

        it('should position node at grid origin for first node', () => {
            render(<WorkspaceControls />);

            const addButton = screen.getByTitle(strings.workspace.addNodeTooltip);
            fireEvent.click(addButton);

            const { nodes } = useCanvasStore.getState();
            expect(nodes[0]?.position).toEqual({ x: 32, y: 32 });
        });

        it('should position subsequent nodes using grid layout', () => {
            render(<WorkspaceControls />);

            const addButton = screen.getByTitle(strings.workspace.addNodeTooltip);

            // Add first node
            fireEvent.click(addButton);
            let nodes = useCanvasStore.getState().nodes;
            expect(nodes[0]?.position).toEqual({ x: 32, y: 32 });

            // Add second node
            fireEvent.click(addButton);
            nodes = useCanvasStore.getState().nodes;
            expect(nodes[1]?.position.x).toBeGreaterThan(32); // Should be in next column
            expect(nodes[1]?.position.y).toBe(32); // Same row
        });

        it('should not add node if no workspace is selected', () => {
            mockWorkspaceCtx.currentWorkspaceId = null;

            render(<WorkspaceControls />);

            const addButton = screen.getByTitle(strings.workspace.addNodeTooltip);
            fireEvent.click(addButton);

            const { nodes } = useCanvasStore.getState();
            expect(nodes).toHaveLength(0);
        });
    });

    describe('Auto Arrange button', () => {
        it('should arrange nodes when clicked', () => {
            useCanvasStore.setState({ nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { prompt: '', output: '', tags: [] }, createdAt: new Date() } as unknown as CanvasNode] });
            render(<WorkspaceControls />);

            const arrangeButton = screen.getByTitle(strings.workspace.arrangeNodesTooltip);
            fireEvent.click(arrangeButton);

            expect(mockPanToPosition).not.toHaveBeenCalled(); // Just arranging, not panning
            // Check implicit success by lack of error and enabled state
            expect(arrangeButton).toBeEnabled();
        });

        it('should be disabled when there are no nodes', () => {
            useCanvasStore.setState({ nodes: [] });
            render(<WorkspaceControls />);
            const arrangeButton = screen.getByTitle(strings.workspace.arrangeNodesTooltip);
            expect(arrangeButton).toBeDisabled();
        });

        it('should show success toast without pinned count when no nodes are pinned', () => {
            const nodes = [
                { id: 'n1', position: { x: 0, y: 0 }, data: { prompt: '', output: '', tags: [] }, createdAt: new Date() } as unknown as CanvasNode,
            ];
            useCanvasStore.setState({ nodes });
            render(<WorkspaceControls />);

            fireEvent.click(screen.getByTitle(strings.workspace.arrangeNodesTooltip));

            expect(mockToastWithAction).toHaveBeenCalledWith(
                strings.layout.arrangeSuccess,
                'success',
                expect.objectContaining({ label: expect.any(String) }),
            );
        });

        it('should show success toast with pinned count when some nodes are pinned', () => {
            const nodes = [
                { id: 'n1', position: { x: 0, y: 0 }, data: { prompt: '', output: '', tags: [], isPinned: true }, createdAt: new Date() } as unknown as CanvasNode,
                { id: 'n2', position: { x: 0, y: 0 }, data: { prompt: '', output: '', tags: [] }, createdAt: new Date() } as unknown as CanvasNode,
            ];
            useCanvasStore.setState({ nodes, pinnedCount: 1 });
            render(<WorkspaceControls />);

            fireEvent.click(screen.getByTitle(strings.workspace.arrangeNodesTooltip));

            expect(mockToastSuccess).toHaveBeenCalledWith(
                strings.layout.arrangeSuccessWithPinned(1)
            );
        });

        it('should show info toast when ALL nodes are pinned', () => {
            const nodes = [
                { id: 'n1', position: { x: 0, y: 0 }, data: { prompt: '', output: '', tags: [], isPinned: true }, createdAt: new Date() } as unknown as CanvasNode,
                { id: 'n2', position: { x: 0, y: 0 }, data: { prompt: '', output: '', tags: [], isPinned: true }, createdAt: new Date() } as unknown as CanvasNode,
            ];
            useCanvasStore.setState({ nodes, pinnedCount: 2 });
            render(<WorkspaceControls />);

            fireEvent.click(screen.getByTitle(strings.workspace.arrangeNodesTooltip));

            expect(mockToastInfo).toHaveBeenCalledWith(strings.layout.allNodesPinned);
            expect(mockToastSuccess).not.toHaveBeenCalled();
        });
    });

    describe('Free Flow toggle button', () => {
        it('should render the free flow button', () => {
            render(<WorkspaceControls />);
            expect(screen.getByTitle(strings.workspace.freeFlowTooltip)).toBeInTheDocument();
        });

        it('should show inactive state by default', () => {
            render(<WorkspaceControls />);
            const button = screen.getByTitle(strings.workspace.freeFlowTooltip);
            expect(button.getAttribute('aria-pressed')).toBe('false');
        });

        it('should toggle canvasFreeFlow when clicked', () => {
            render(<WorkspaceControls />);
            const button = screen.getByTitle(strings.workspace.freeFlowTooltip);
            fireEvent.click(button);
            expect(useSettingsStore.getState().canvasFreeFlow).toBe(true);
        });

        it('should show active state when canvasFreeFlow is true', () => {
            useSettingsStore.setState({ canvasFreeFlow: true });
            render(<WorkspaceControls />);
            const button = screen.getByTitle(strings.workspace.freeFlowTooltip);
            expect(button.getAttribute('aria-pressed')).toBe('true');
        });

        it('should have accessible label from string resource', () => {
            render(<WorkspaceControls />);
            const button = screen.getByLabelText(strings.workspace.freeFlowTooltip);
            expect(button).toBeInTheDocument();
        });
    });

});
