/**
 * scripts/push-docs-tick.sh — direct push to main is allowed ONLY for launch
 * checklist/changelog/evidence ticks. `--check-only` runs the guards without
 * running tests or pushing, so they can be exercised against throwaway repos.
 */
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts', 'push-docs-tick.sh');
const CHECKLIST = 'docs/launch/LAUNCH-CHECKLIST.md';

let root: string;
let work: string;

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function commitFile(path: string, content = 'x\n'): void {
    mkdirSync(join(work, path, '..'), { recursive: true });
    writeFileSync(join(work, path), content);
    git(work, 'add', path);
    git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', `edit ${path}`);
}

function run(): { status: number | null; output: string } {
    const result = spawnSync('bash', [SCRIPT, '--check-only'], { cwd: work, encoding: 'utf-8' });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'docs-tick-'));
    const remote = join(root, 'remote.git');
    work = join(root, 'work');
    git(root, 'init', '-q', '--bare', '-b', 'main', remote);
    git(root, 'clone', '-q', remote, work);
    git(work, 'checkout', '-q', '-b', 'main');
    commitFile('README.txt');
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'checkout', '-q', '-b', 'docs/tick');
});

afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('push-docs-tick.sh guards', () => {
    it('accepts a commit that only touches launch docs', () => {
        commitFile(CHECKLIST);
        commitFile('docs/launch/LAUNCH-CHANGELOG.md');
        expect(run().status).toBe(0);
    });

    it('rejects a commit that also touches code', () => {
        commitFile(CHECKLIST);
        commitFile('src/app.ts');
        const { status, output } = run();
        expect(status).not.toBe(0);
        expect(output).toContain('src/app.ts');
    });

    it('rejects other docs (only checklist, changelog and evidence are exempt)', () => {
        commitFile('docs/README.md');
        const { status, output } = run();
        expect(status).not.toBe(0);
        expect(output).toContain('docs/README.md');
    });

    it('rejects an empty diff', () => {
        const { status, output } = run();
        expect(status).not.toBe(0);
        expect(output).toContain('nothing to push');
    });

    it('rejects when main has moved on (not a fast-forward)', () => {
        commitFile(CHECKLIST);
        git(work, 'checkout', '-q', 'main');
        commitFile('other.txt');
        git(work, 'push', '-q', 'origin', 'main');
        git(work, 'checkout', '-q', 'docs/tick');
        const { status, output } = run();
        expect(status).not.toBe(0);
        expect(output).toContain('not up to date with origin/main');
    });
});
