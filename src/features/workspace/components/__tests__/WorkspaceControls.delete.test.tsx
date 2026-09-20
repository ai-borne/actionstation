/**
 * WorkspaceControls Delete Tests - Delete workspace button behavior
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { WorkspaceControls } from '../WorkspaceControls';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { useWorkspaceStore, DEFAULT_WORKSPACE_ID } from '../../stores/workspaceStore';
import { useCanvasStore } from '@/features/canvas/stores/canvasStore';
import { useSettingsStore } from '@/shared/stores/settingsStore';
import { strings } from '@/shared/localization/strings';
import { deleteWorkspace } from '../../services/workspaceService';
import { onNodesDeleted } from '@/features/canvas/services/nodeDeletionSignal';
import type { CanvasNode } from '@/features/canvas/types/node';

vi.mock('../../services/workspaceService', () => ({
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
}));

const mockConfirm = vi.fn().mockResolvedValue(false);
vi.mock('@/shared/stores/confirmStore', () => ({
    useConfirm: () => mockConfirm,
    useConfirmStore: vi.fn(),
}));

const mockPanToPosition = vi.fn();
vi.mock('@/features/canvas/hooks/usePanToNode', () => ({
    usePanToNode: () => ({
        panToPosition: mockPanToPosition,
    }),
}));

vi.mock('@/shared/stores/toastStore', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));
vi.mock('@/features/subscription/hooks/useNodeCreationGuard', () => ({ useNodeCreationGuard: () => ({ guardNodeCreation: () => true }) }));

describe('WorkspaceControls - Delete Workspace', () => {
    beforeEach(() => {
        vi.clearAllMocks();

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

        useCanvasStore.setState({
            nodes: [],
            edges: [],
            selectedNodeIds: new Set(),
        });

        useSettingsStore.setState({ canvasFreeFlow: false });
        mockConfirm.mockResolvedValue(false);
    });

    it('should show error toast when trying to delete default workspace', async () => {
        const { toast } = await import('@/shared/stores/toastStore');
        useWorkspaceStore.setState({ currentWorkspaceId: DEFAULT_WORKSPACE_ID });

        render(<WorkspaceControls />);

        const deleteButton = screen.getByTitle(strings.workspace.deleteWorkspaceTooltip);
        await act(async () => {
            fireEvent.click(deleteButton);
        });

        expect(toast.error).toHaveBeenCalledWith(strings.workspace.deleteDefaultError);
    });

    it('should show confirmation dialog when deleting non-default workspace', async () => {
        render(<WorkspaceControls />);

        const deleteButton = screen.getByTitle(strings.workspace.deleteWorkspaceTooltip);
        await act(async () => {
            fireEvent.click(deleteButton);
        });

        expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
            message: strings.workspace.deleteConfirm,
            isDestructive: true,
        }));
    });

    it('should not delete workspace when confirmation is cancelled', async () => {
        mockConfirm.mockResolvedValue(false);

        render(<WorkspaceControls />);

        const deleteButton = screen.getByTitle(strings.workspace.deleteWorkspaceTooltip);
        await act(async () => {
            fireEvent.click(deleteButton);
        });

        expect(deleteWorkspace).not.toHaveBeenCalled();
    });

    it('should delete workspace when confirmed', async () => {
        const { toast } = await import('@/shared/stores/toastStore');
        mockConfirm.mockResolvedValue(true);

        render(<WorkspaceControls />);

        const deleteButton = screen.getByTitle(strings.workspace.deleteWorkspaceTooltip);
        await act(async () => {
            fireEvent.click(deleteButton);
        });

        await waitFor(() => {
            expect(deleteWorkspace).toHaveBeenCalledWith('test-user-id', 'workspace-1');
        });

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith(strings.workspace.deleteSuccess);
        });
    });

    describe('announces the deleted workspace\'s cards so their Google events are removed', () => {
        const card = (id: string): CanvasNode => ({
            id, workspaceId: 'workspace-1', type: 'idea', data: { heading: id },
            position: { x: 0, y: 0 }, createdAt: new Date(), updatedAt: new Date(),
        });

        async function deleteCurrentWorkspace(): Promise<CanvasNode[][]> {
            const listener = vi.fn();
            const off = onNodesDeleted(listener);
            mockConfirm.mockResolvedValue(true);
            render(<WorkspaceControls />);
            await act(async () => { fireEvent.click(screen.getByTitle(strings.workspace.deleteWorkspaceTooltip)); });
            await waitFor(() => { expect(deleteWorkspace).toHaveBeenCalled(); });
            off();
            return listener.mock.calls.map((c) => c[0] as CanvasNode[]);
        }

        it('when other workspaces remain', async () => {
            useWorkspaceStore.setState({
                workspaces: [
                    ...useWorkspaceStore.getState().workspaces,
                    { id: 'workspace-2', userId: 'test-user-id', name: 'Other', canvasSettings: { backgroundColor: 'grid' }, createdAt: new Date(), updatedAt: new Date() },
                ],
            });
            useCanvasStore.setState({ nodes: [card('a'), card('b')] });
            const calls = await deleteCurrentWorkspace();
            expect(calls).toHaveLength(1);
            expect(calls[0]!.map((n) => n.id)).toEqual(['a', 'b']);
        });

        it('when it was the last workspace', async () => {
            useCanvasStore.setState({ nodes: [card('a')] });
            const calls = await deleteCurrentWorkspace();
            expect(calls).toHaveLength(1);
            expect(calls[0]!.map((n) => n.id)).toEqual(['a']);
        });

        it('but not when the delete fails', async () => {
            vi.mocked(deleteWorkspace).mockRejectedValueOnce(new Error('nope'));
            useCanvasStore.setState({ nodes: [card('a')] });
            const listener = vi.fn();
            const off = onNodesDeleted(listener);
            mockConfirm.mockResolvedValue(true);
            render(<WorkspaceControls />);
            await act(async () => { fireEvent.click(screen.getByTitle(strings.workspace.deleteWorkspaceTooltip)); });
            await waitFor(() => { expect(deleteWorkspace).toHaveBeenCalled(); });
            off();
            expect(listener).not.toHaveBeenCalled();
        });
    });

    it('should not work when user is not authenticated', () => {
        useAuthStore.setState({ user: null, isAuthenticated: false });

        render(<WorkspaceControls />);

        const deleteButton = screen.getByTitle(strings.workspace.deleteWorkspaceTooltip);
        fireEvent.click(deleteButton);

        expect(mockConfirm).not.toHaveBeenCalled();
    });
});
