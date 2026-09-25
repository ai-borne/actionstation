/**
 * Structural test: docs-only changes must not pay for an app build.
 *
 * preview.yml rebuilt and re-tested the whole app for every PR, including
 * two-line checklist ticks (~8 min each, PR #106). Docs-only PRs are still
 * checked by ci.yml (which runs docsIntegrity), so only the preview is skipped.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const preview = readFileSync(join(process.cwd(), '.github', 'workflows', 'preview.yml'), 'utf-8');
const pullRequestBlock = /^ {2}pull_request:\n((?: {4}.*\n)+)/m.exec(preview)?.[1] ?? '';

describe('preview.yml skips docs-only PRs', () => {
    it('declares paths-ignore on pull_request', () => {
        expect(pullRequestBlock).toContain('paths-ignore:');
    });

    it.each(['docs/**', 'plans/**', '**/*.md'])('ignores %s', (path) => {
        expect(pullRequestBlock).toContain(`'${path}'`);
    });

    it.each(['src/**', 'functions/**', 'firebase.json', 'firestore.rules', '.github/**', 'package.json'])(
        'never ignores %s (code that ships or CI itself)',
        (path) => {
            expect(pullRequestBlock).not.toContain(`'${path}'`);
        },
    );

    it('keeps ci.yml free of path filters so docsIntegrity always runs on PRs', () => {
        const ci = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf-8');
        expect(/^on:\n([\s\S]*?)^env:/m.exec(ci)?.[1] ?? '').not.toContain('paths');
    });
});
