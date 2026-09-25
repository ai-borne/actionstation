/**
 * Structural test: PR preview channels are deleted when the PR closes.
 *
 * Firebase Hosting allows 50 preview channels per site. preview.yml created
 * `pr-<N>` for every PR with a 7-day expiry and never deleted it, so ~50 merged
 * PRs in a week filled the quota and PR #102's preview deploy failed with
 * 429 "channel quota reached" (2026-09-25).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const preview = readFileSync(join(process.cwd(), '.github', 'workflows', 'preview.yml'), 'utf-8');

/** Returns the body of a top-level job (everything indented under `  <name>:`). */
function jobBlock(name: string): string {
    const match = new RegExp(`^  ${name}:\\n((?:(?:    .*)?\\n)+)`, 'm').exec(preview);
    return match?.[1] ?? '';
}

describe('preview.yml channel cleanup', () => {
    const cleanup = jobBlock('cleanup');

    it('runs on pull_request closed', () => {
        expect(preview).toMatch(/types:\s*\[[^\]]*\bclosed\b[^\]]*\]/);
    });

    it('does not build or deploy a preview for a closed PR', () => {
        expect(jobBlock('preview')).toMatch(/if:\s*github\.event\.action != 'closed'/);
    });

    it('has a cleanup job that only runs on close', () => {
        expect(cleanup, 'preview.yml needs a `cleanup` job').not.toBe('');
        expect(cleanup).toMatch(/if:\s*github\.event\.action == 'closed'/);
    });

    it('deletes this PR\'s channel with a pinned firebase-tools', () => {
        expect(cleanup).toMatch(/firebase-tools@\$\{\{\s*env\.FIREBASE_TOOLS_VERSION\s*\}\}\s+hosting:channel:delete/);
        expect(cleanup).toContain('pr-${{ github.event.pull_request.number }}');
    });

    it('keeps a short expiry as a fallback for missed cleanups', () => {
        const days = Number(/expires:\s*(\d+)d/.exec(preview)?.[1]);
        expect(days).toBeGreaterThan(0);
        expect(days).toBeLessThanOrEqual(3);
    });
});
