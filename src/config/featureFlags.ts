/**
 * Feature flags — production guards for incomplete feature wiring.
 *
 * spatialChunking: Sprint D must wire tile load/save before enabling in prod.
 * While false, workspace.spatialChunkingEnabled is ignored (defaults stay false).
 */
/* eslint-disable @typescript-eslint/no-unnecessary-condition -- intentional kill switch until Sprint D */
export const SPATIAL_CHUNKING_PROD_ENABLED = false;

/** Resolve whether tile-based spatial chunking is active for a workspace. */
export function resolveSpatialChunkingEnabled(workspaceFlag?: boolean): boolean {
    if (!SPATIAL_CHUNKING_PROD_ENABLED) return false;
    return workspaceFlag === true;
}
/* eslint-enable @typescript-eslint/no-unnecessary-condition */
