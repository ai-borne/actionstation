/**
 * Structural test: CI/CD workflow guardrails (launch checklist C11, C12, C13)
 *
 * C11 — firebase-tools must be pinned. An unpinned `npx firebase-tools` picked up
 *       v15 and broke `storage:rules` on a production deploy.
 * C12 — docs-only pushes to main must not trigger a production deploy.
 * C13 — pull requests must dry-run the Firebase deploy so config breaks are
 *       caught before merge.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const WORKFLOWS_DIR = join(process.cwd(), '.github', 'workflows');
const SEMVER = /^\d+\.\d+\.\d+$/;

function readWorkflow(name: string): string {
    return readFileSync(join(WORKFLOWS_DIR, name), 'utf-8');
}

function allWorkflows(): ReadonlyArray<{ readonly name: string; readonly source: string }> {
    return readdirSync(WORKFLOWS_DIR)
        .filter((f) => f.endsWith('.yml'))
        .map((name) => ({ name, source: readWorkflow(name) }));
}

/** Extracts the value of `FIREBASE_TOOLS_VERSION: '<x>'` from a workflow. */
function pinnedVersion(source: string): string | null {
    const match = /^\s*FIREBASE_TOOLS_VERSION:\s*['"]?([^\s'"#]+)['"]?/m.exec(source);
    return match?.[1] ?? null;
}

describe('C11 — firebase-tools is pinned in every workflow', () => {
    const PINNED_INVOCATION =
        /firebase-tools@(?:\d+\.\d+\.\d+|\$\{\{\s*env\.FIREBASE_TOOLS_VERSION\s*\}\})/;

    it('never runs firebase-tools without an explicit version', () => {
        for (const { name, source } of allWorkflows()) {
            const invocations = source
                .split('\n')
                .filter((line) => !line.trim().startsWith('#'))
                .filter((line) => /npx\b.*firebase-tools/.test(line));
            for (const line of invocations) {
                expect(
                    line,
                    `${name}: "${line.trim()}" must use firebase-tools@<version> (pin it).`,
                ).toMatch(PINNED_INVOCATION);
            }
        }
    });

    it('declares FIREBASE_TOOLS_VERSION as an exact semver wherever it is referenced', () => {
        for (const { name, source } of allWorkflows()) {
            if (!source.includes('env.FIREBASE_TOOLS_VERSION')) continue;
            const version = pinnedVersion(source);
            expect(version, `${name} references FIREBASE_TOOLS_VERSION but does not define it.`)
                .not.toBeNull();
            expect(version, `${name}: FIREBASE_TOOLS_VERSION must be exact x.y.z, not a range/tag.`)
                .toMatch(SEMVER);
        }
    });

    it('uses the same version in deploy.yml and ci.yml', () => {
        expect(pinnedVersion(readWorkflow('deploy.yml'))).toBe(pinnedVersion(readWorkflow('ci.yml')));
    });
});

describe('C12 — docs-only pushes do not deploy production', () => {
    const deploy = readWorkflow('deploy.yml');
    const pushBlock = /^on:\s*\n\s+push:\s*\n([\s\S]*?)(?=^\S|\n\s{2}workflow_dispatch:)/m.exec(deploy)?.[1] ?? '';

    it('ignores documentation paths on push to main', () => {
        expect(pushBlock, 'deploy.yml on.push must define paths-ignore').toContain('paths-ignore:');
        for (const path of ['docs/**', 'plans/**', '**/*.md']) {
            expect(pushBlock, `paths-ignore must include ${path}`).toContain(`'${path}'`);
        }
    });

    it('never ignores code that ships (src, functions, rules, configs)', () => {
        for (const path of ['src/**', 'functions/**', 'firestore.rules', 'storage.rules', 'firebase.json']) {
            expect(pushBlock, `${path} must not be in paths-ignore`).not.toContain(`'${path}'`);
        }
    });

    it('still allows a manual deploy via workflow_dispatch', () => {
        expect(deploy).toMatch(/^\s{2}workflow_dispatch:/m);
    });
});

describe('C13 — pull requests dry-run the Firebase deploy', () => {
    const ci = readWorkflow('ci.yml');

    it('has a dry-run deploy job covering rules, indexes and functions', () => {
        expect(ci).toMatch(/firebase-tools@[^\n]*deploy[^\n]*--dry-run/);
        const line = ci.split('\n').find((l) => l.includes('--dry-run')) ?? '';
        for (const target of ['firestore:rules', 'storage:rules', 'firestore:indexes', 'functions']) {
            expect(line, `dry-run must cover ${target}`).toContain(target);
        }
    });

    it('runs only on same-repo pull requests (secrets are unavailable to forks)', () => {
        expect(ci).toContain("github.event_name == 'pull_request'");
        expect(ci).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    });

    it('authenticates with Workload Identity Federation, not stored keys or personal tokens', () => {
        const job = /^ {2}firebase-dry-run:[\s\S]*?(?=^ {2}\w[\w-]*:\s*$)/m.exec(ci)?.[0] ?? '';
        expect(job, 'firebase-dry-run job not found in ci.yml').not.toBe('');
        expect(job).toContain('workload_identity_provider:');
        expect(job).toMatch(/id-token:\s*write/);
        expect(job, 'PR runs must not receive a deploy-capable key or personal token').not.toMatch(
            /secrets\.(FIREBASE_SERVICE_ACCOUNT|FIREBASE_CI_TOKEN)|FIREBASE_TOKEN/,
        );
    });

    it('never performs a real deploy from ci.yml', () => {
        const deployLines = ci.split('\n').filter((l) => /firebase-tools[^\n]*\bdeploy\b/.test(l));
        expect(deployLines.length).toBeGreaterThan(0);
        for (const line of deployLines) {
            expect(line, 'every deploy in ci.yml must be --dry-run').toContain('--dry-run');
        }
    });
});
