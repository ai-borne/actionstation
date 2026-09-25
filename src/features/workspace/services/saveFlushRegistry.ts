/**
 * Save flush registry: lets code outside the autosave hook (the workspace switcher)
 * save the workspace being left. Each workspace's useSaveCallback registers its
 * save() under its own id, so a flush can never run against another workspace's state.
 */
type Flush = () => Promise<boolean>;

const flushes = new Map<string, Flush>();

/** Registers `flush` for a workspace; the returned function removes it (only if still the current one). */
export function registerSaveFlush(workspaceId: string, flush: Flush): () => void {
    flushes.set(workspaceId, flush);
    return () => {
        if (flushes.get(workspaceId) === flush) flushes.delete(workspaceId);
    };
}

/** Runs the workspace's registered flush. Resolves false when none is registered or it did not persist/queue. */
export function flushWorkspaceSave(workspaceId: string): Promise<boolean> {
    const flush = flushes.get(workspaceId);
    return flush ? flush() : Promise.resolve(false);
}
