/**
 * Structural test: Google Calendar sync wiring (A10d).
 * - The background sync is mounted for the signed-in app, otherwise edits/deletes never sync.
 * - Node deletions reach Calendar only through the canvas deletion signal (one choke point):
 *   no per-caller cleanup hooks, and clearCanvas() stays an UNLOAD (it never announces deletions),
 *   so it may only be called by the allow-listed unload sites.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(__dirname, '..');

function collectSources(dir: string, files: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'test') continue;
            collectSources(full, files);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
            files.push(full);
        }
    }
    return files;
}

const rel = (file: string): string => path.relative(SRC_DIR, file).split(path.sep).join('/');
const read = (file: string): string => fs.readFileSync(file, 'utf-8');

/** Unload-only callers of clearCanvas(): the data still exists in storage after these. */
const CLEAR_CANVAS_UNLOAD_SITES = new Set([
    'app/hooks/useWorkspaceOperations.ts', // new workspace: previous workspace stays saved
    'features/workspace/components/DeleteWorkspaceButton.tsx', // last workspace deleted: emits deletions first
    'features/canvas/stores/canvasStore.ts', // type declaration
    'features/canvas/stores/canvasStoreActions.ts', // definition + deleteAllNodes
]);

describe('Calendar sync wiring', () => {
    const files = collectSources(SRC_DIR);

    it('mounts the background calendar sync in the authenticated app', () => {
        expect(read(path.join(SRC_DIR, 'App.tsx'))).toMatch(/useCalendarNodeSync\(\)/);
    });

    it('has no per-caller calendar cleanup on delete (the deletion signal is the only path)', () => {
        const offenders = files.filter((f) => /cleanupOnDelete|syncDelete/.test(read(f))).map(rel);
        expect(offenders).toEqual([]);
    });

    it('only allow-listed unload sites call clearCanvas()', () => {
        const offenders = files
            .filter((f) => /\.clearCanvas\(\)|clearCanvas:\s*\(\)/.test(read(f)))
            .map(rel)
            .filter((f) => !CLEAR_CANVAS_UNLOAD_SITES.has(f));
        expect(offenders).toEqual([]);
    });

    it('the canvas feature never imports the calendar sync internals (dependency is inverted)', () => {
        const offenders = files
            .filter((f) => rel(f).startsWith('features/canvas/'))
            .filter((f) => /calendar\/(services\/calendar(SyncController|DeleteQueue|UpdateScheduler|NodeOps)|policy)/.test(read(f)))
            .map(rel);
        expect(offenders).toEqual([]);
    });
});
