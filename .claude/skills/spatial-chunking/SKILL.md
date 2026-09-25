---
name: spatial-chunking
description: Tile-based Firestore storage rules and key modules. Use when touching tiles, tileLoader, tiledNodeWriter or workspace.spatialChunkingEnabled.
---

Reduces Firestore reads by ~80-95% at scale. Feature-flagged via `workspace.spatialChunkingEnabled`.

**Tile size**: `TILE_SIZE = 2000` px. **Tile ID format**: `tile_{xIndex}_{yIndex}`.

**Key modules**: `tileCalculator.ts` (math), `tileLoader.ts` (reads + cache), `tiledNodeWriter.ts` (writes), `tileReducer.ts` (state machine), `useViewportTileLoader.ts` (React hook), `useTiledSaveCallback.ts` (dirty tracking).

**Rules**: (1) Feature-flagged. (2) Tile eviction after 60s. (3) Dirty tracking in `useEffect`, never during render. (4) Use `useReducer` isolated from canvas store. (5) Migration paginated, idempotent. (6) Firestore rules mirror flat `nodes/` auth rules.
