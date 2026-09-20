/**
 * Structural test: Firestore security rules defense-in-depth.
 *
 * Invariants enforced:
 * 1. Default-deny rule exists (catch-all `allow read, write: if false`).
 * 2. nodes, edges, and tiles/nodes write rules all check request.auth.uid.
 * 3. Those rules guard userId with `resource == null` BEFORE reading
 *    resource.data — without this guard, Firestore throws a null-reference
 *    error on every *create* (new document), which silently denies writes.
 *    Regression: this guard was missing and caused "Save failed" toasts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const RULES_PATH = path.resolve(__dirname, '..', '..', 'firestore.rules');

/** The correct userId guard pattern — covers creates (resource==null) and updates. */
const SAFE_USERID_GUARD = 'resource == null || !resource.data.userId || resource.data.userId == request.auth.uid';

describe('Firestore rules defense-in-depth', () => {
    const content = fs.readFileSync(RULES_PATH, 'utf-8');

    it('firestore.rules exists and is non-empty', () => {
        expect(content.length).toBeGreaterThan(0);
    });

    it('default deny rule exists', () => {
        expect(content).toContain('allow read, write: if false');
    });

    it('nodes write rule includes request.auth.uid check', () => {
        const nodesSection = content.slice(
            content.indexOf('match /nodes/{nodeId}'),
            content.indexOf('match /edges/{edgeId}')
        );
        expect(nodesSection).toContain('request.auth.uid');
    });

    it('edges write rule includes request.auth.uid check', () => {
        const edgesSection = content.slice(
            content.indexOf('match /edges/{edgeId}'),
            content.indexOf('match /knowledgeBank/{entryId}')
        );
        expect(edgesSection).toContain('request.auth.uid');
    });

    it('tiles/nodes write rule includes request.auth.uid check', () => {
        const tilesSection = content.slice(
            content.indexOf('match /tiles/{tileId}/nodes/{nodeId}'),
        );
        expect(tilesSection).toContain('request.auth.uid');
    });

    // --- Regression guard: resource == null must precede resource.data access ---
    // Without this, Firestore throws a null-reference on every create (new document)
    // and silently denies the write, causing "Failed to save changes" toasts.

    it('nodes write rule guards resource == null before reading resource.data (create-safe)', () => {
        const nodesSection = content.slice(
            content.indexOf('match /nodes/{nodeId}'),
            content.indexOf('match /edges/{edgeId}')
        );
        expect(nodesSection).toContain(SAFE_USERID_GUARD);
    });

    it('edges write rule guards resource == null before reading resource.data (create-safe)', () => {
        const edgesSection = content.slice(
            content.indexOf('match /edges/{edgeId}'),
            content.indexOf('match /knowledgeBank/{entryId}')
        );
        expect(edgesSection).toContain(SAFE_USERID_GUARD);
    });

    it('tiles/nodes write rule guards resource == null before reading resource.data (create-safe)', () => {
        const tilesSection = content.slice(
            content.indexOf('match /tiles/{tileId}/nodes/{nodeId}'),
        );
        expect(tilesSection).toContain(SAFE_USERID_GUARD);
    });

    it('integrations subcollection is server-only (no client read/write)', () => {
        const integrationsSection = content.slice(
            content.indexOf('match /integrations/{integrationId}'),
            content.indexOf('match /usage/aiDaily'),
        );
        expect(integrationsSection).toContain('allow read, write: if false');
    });

    it('no write rule uses bare resource.data.userId without null guard', () => {
        // Strip the correct pattern first, then check no bare (unguarded) usage remains.
        const stripped = content.split(SAFE_USERID_GUARD).join('__OK__');
        // A bare !resource.data.userId without the preceding null guard is the bug pattern.
        expect(stripped).not.toMatch(/allow write:.*(?<!resource == null \|\| )!resource\.data\.userId/);
    });
});
