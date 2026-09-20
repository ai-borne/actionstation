/**
 * Structural test: CI must never cancel or replace a run for a commit on main (checklist C16).
 *
 * `ci.yml` grouped runs by branch with `cancel-in-progress: true`, so a second merge to `main`
 * minutes after the first cancelled the first merge commit's post-merge CI (run #681, 2026-09-20)
 * and left that commit with no completed CI record. Every commit on `main` needs its own
 * concurrency group; PRs and feature branches may still cancel superseded runs.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const ci = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf-8');

function concurrencyBlock(source: string): string {
    const match = /^concurrency:\n((?:[ \t]+.*\n?)+)/m.exec(source);
    return match?.[1] ?? '';
}

describe('ci.yml concurrency', () => {
    const block = concurrencyBlock(ci);

    it('has a concurrency block', () => {
        expect(block).not.toBe('');
    });

    it('gives every commit on main its own group (keyed by the commit SHA)', () => {
        const group = /group:\s*(.+)/.exec(block)?.[1] ?? '';
        expect(group).toContain("github.ref == 'refs/heads/main'");
        expect(group).toContain('github.sha');
    });

    it('still groups pull requests by number so superseded PR runs are cancelled', () => {
        const group = /group:\s*(.+)/.exec(block)?.[1] ?? '';
        expect(group).toContain('github.event.pull_request.number');
        expect(block).toMatch(/cancel-in-progress:\s*true/);
    });

    it('does not group main pushes by branch name alone', () => {
        const group = /group:\s*(.+)/.exec(block)?.[1] ?? '';
        // The old expression fell through to github.ref for every push, including main.
        expect(group).not.toMatch(/pull_request\.number\s*\|\|\s*github\.ref\s*\}\}\s*$/);
    });
});
