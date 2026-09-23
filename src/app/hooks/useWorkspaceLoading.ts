/**
 * useWorkspaceLoading Hook - Handles initial loading and hydration of workspaces
 *
 * The load is bounded: if Firestore or IndexedDB never answers (seen on Safari
 * with a wedged local cache), cached workspace metadata is shown after
 * WORKSPACE_LIST_TIMEOUT_MS with a Retry toast instead of an endless spinner.
 * A fresh list that arrives later still replaces the cached one.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { useWorkspaceStore } from '@/features/workspace/stores/workspaceStore';
import { workspaceCache } from '@/features/workspace/services/workspaceCache';
import { indexedDbService, IDB_STORES } from '@/shared/services/indexedDbService';
import { loadUserWorkspaces } from '@/features/workspace/services/workspaceService';
import { getLastWorkspaceId } from '@/features/workspace/services/lastWorkspaceService';
import type { Workspace, CanvasBackground } from '@/features/workspace/types/workspace';
import { toastWithAction } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';
import { logger } from '@/shared/services/logger';

export const WORKSPACE_LIST_TIMEOUT_MS = 15_000;
const SLOW_LOAD_TOAST_MS = 15_000;
const METADATA_KEY = '__workspace_metadata__';
const TIMED_OUT = Symbol('timed-out');

interface WorkspaceMetadata {
    id: string;
    name: string;
    type?: string;
    orderIndex?: number;
    backgroundColor?: CanvasBackground;
    updatedAt: number;
}

function persistMetadata(loaded: readonly Workspace[]): void {
    const metadata: WorkspaceMetadata[] = loaded.map((ws) => ({
        id: ws.id,
        name: ws.name,
        type: ws.type,
        orderIndex: ws.orderIndex,
        backgroundColor: ws.canvasSettings.backgroundColor,
        updatedAt: Date.now(),
    }));
    indexedDbService
        .put(IDB_STORES.metadata, METADATA_KEY, metadata)
        .catch((err: unknown) => logger.warn('[useWorkspaceLoading] IDB write failed:', err));
}

function selectCurrentWorkspace(loaded: readonly Workspace[]): string | undefined {
    const store = useWorkspaceStore.getState();
    const firstReal = loaded.find((ws) => ws.type !== 'divider');
    if (!loaded.some((ws) => ws.id === store.currentWorkspaceId)) {
        const lastId = getLastWorkspaceId();
        if (lastId && loaded.some((ws) => ws.id === lastId)) store.setCurrentWorkspaceId(lastId);
        else if (firstReal) store.setCurrentWorkspaceId(firstReal.id);
    }
    return useWorkspaceStore.getState().currentWorkspaceId ?? firstReal?.id;
}

function applyLoadedWorkspaces(uid: string, loaded: Workspace[]): void {
    useWorkspaceStore.getState().setWorkspaces(loaded);
    persistMetadata(loaded);
    const activeId = selectCurrentWorkspace(loaded);
    // Only preload the active workspace on boot — others load on demand. Preloading
    // all workspaces fires N×2 Firestore reads that compete with the current load.
    if (loaded.length > 0 && activeId) {
        workspaceCache.preload(uid, [activeId]).catch((err: unknown) => {
            logger.warn('[useWorkspaceLoading] Cache preload failed:', err);
        });
    }
}

async function applyCachedMetadata(uid: string): Promise<void> {
    const cached = await indexedDbService.get<WorkspaceMetadata[]>(IDB_STORES.metadata, METADATA_KEY);
    if (!cached?.length) return;
    useWorkspaceStore.getState().setWorkspaces(cached.map((m) => ({
        id: m.id,
        userId: uid,
        name: m.name,
        type: (m.type ?? 'workspace') as 'workspace' | 'divider',
        orderIndex: m.orderIndex ?? 0,
        canvasSettings: { backgroundColor: m.backgroundColor ?? 'grid' as CanvasBackground },
        createdAt: new Date(m.updatedAt),
        updatedAt: new Date(m.updatedAt),
    })));
}

async function loadWorkspaceList(uid: string, isActive: () => boolean, onRetry: () => void): Promise<void> {
    const fresh = Promise.all([workspaceCache.hydrateFromIdb(), loadUserWorkspaces(uid)])
        .then(([, loaded]) => loaded);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), WORKSPACE_LIST_TIMEOUT_MS);
    });
    try {
        const first = await Promise.race([fresh, timeout]);
        if (first === TIMED_OUT) {
            if (!isActive()) return;
            logger.warn('[useWorkspaceLoading] Workspace list load timed out; showing cached list');
            await applyCachedMetadata(uid);
            toastWithAction(strings.workspace.loadSlow, 'warning',
                { label: strings.common.retry, onClick: onRetry }, SLOW_LOAD_TOAST_MS);
        }
        const loaded = await fresh; // a late fresh list still replaces the cached one
        if (isActive()) applyLoadedWorkspaces(uid, loaded);
    } catch (error) {
        logger.error('[useWorkspaceLoading] Failed to load workspaces:', error);
        if (isActive()) await applyCachedMetadata(uid);
    } finally {
        clearTimeout(timer);
    }
}

export function useWorkspaceLoading() {
    const userId = useAuthStore((s) => s.user?.id);
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt((n) => n + 1), []);

    useEffect(() => {
        if (!userId) return;
        let isActive = true;
        loadWorkspaceList(userId, () => isActive, retry).catch((err: unknown) => {
            logger.error('[useWorkspaceLoading] Unexpected load failure:', err);
        });
        return () => { isActive = false; };
    }, [userId, attempt, retry]);
}
