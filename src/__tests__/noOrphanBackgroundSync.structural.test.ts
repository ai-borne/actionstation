/**
 * Structural test: no Background Sync registration without a consumer.
 * The PWA uses generateSW (no custom sync handler) and the offline queue lives in
 * localStorage (unreachable from a service worker), so a registered sync tag is never
 * consumed and sticks forever. If a real handler is added, delete this guard with it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(__dirname, '..');
const SYNC_REGISTRATION = /\bsync\s*\.\s*register\s*\(|\bSyncManager\b/;

function collectFiles(dir: string, files: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'test') continue;
            collectFiles(full, files);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
            files.push(full);
        }
    }
    return files;
}

describe('no orphan Background Sync registration', () => {
    it('src/ never registers a Background Sync tag', () => {
        const violations = collectFiles(SRC_DIR)
            .filter((file) => SYNC_REGISTRATION.test(fs.readFileSync(file, 'utf-8')))
            .map((file) => path.relative(SRC_DIR, file));
        expect(violations).toEqual([]);
    });
});
