/**
 * Infrastructure Structural Tests
 * Validates backup bucket config and health endpoint export.
 *
 * Prevents regression:
 * - Backup must default to immutable bucket (not the old non-immutable one)
 * - Health endpoint must be exported from index.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const SRC_DIR = join(__dirname, '..');
const BACKUP_SRC = readFileSync(join(SRC_DIR, 'firestoreBackup.ts'), 'utf-8');
const INDEX_SRC = readFileSync(join(SRC_DIR, 'index.ts'), 'utf-8');

describe('firestoreBackup — immutable bucket config', () => {
    it('defaults to the immutable backup bucket name', () => {
        expect(BACKUP_SRC).toContain('firestore-backups-immutable');
    });

    it('does not hardcode the old non-immutable bucket as the primary', () => {
        // The old bucket name without -immutable should not appear as a direct assignment
        const oldBucketPattern = /BACKUP_BUCKET\s*=\s*`gs:\/\/.*firestore-backups`/;
        expect(
            oldBucketPattern.test(BACKUP_SRC),
            'BACKUP_BUCKET should default to the immutable bucket, not the old one',
        ).toBe(false);
    });

    it('reads bucket name from environment variable', () => {
        expect(BACKUP_SRC).toContain('process.env.BACKUP_BUCKET_NAME');
    });
});

describe('index.ts — required function exports', () => {
    const requiredExports = [
        'health',
        'geminiProxy',
        'fetchLinkMeta',
        'proxyImage',
        'onNodeDeleted',
        'onUserDeleted',
        'onStorageObjectFinalized',
        'onStorageObjectDeleted',
        'gdprServerExport',
        'razorpayWebhook',
        'firestoreBackup',
        'verifyTurnstile',
        'workspaceBundle',
    ];

    for (const fn of requiredExports) {
        it(`exports ${fn}`, () => {
            expect(INDEX_SRC).toContain(fn);
        });
    }
});
