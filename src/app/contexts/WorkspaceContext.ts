/**
 * WorkspaceContext - Bridges workspace → canvas boundary.
 * Provided by the app layer so canvas hooks can access workspaceId
 * without importing workspace stores directly.
 */
import { createContext, useContext } from 'react';

interface WorkspaceContextValue {
    currentWorkspaceId: string | null;
    isSwitching: boolean;
    /** True until the current workspace's data has loaded; the load replaces canvas state. */
    isLoading: boolean;
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
    currentWorkspaceId: null,
    isSwitching: false,
    isLoading: false,
});

export function useWorkspaceContext(): WorkspaceContextValue {
    return useContext(WorkspaceContext);
}
