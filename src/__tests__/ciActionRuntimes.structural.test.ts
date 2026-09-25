/**
 * Structural test: GitHub Actions must run on a Node 24 action runtime (checklist C10).
 *
 * Node 20 JavaScript actions are deprecated by GitHub. Each entry is the first major version
 * of that action whose `action.yml` declares `using: node24`. This is separate from the
 * `node-version` the project's own steps run with.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const WORKFLOW_DIR = join(process.cwd(), '.github', 'workflows');

const MIN_MAJOR: Readonly<Record<string, number>> = {
    'actions/checkout': 7,
    'actions/setup-node': 7,
    'actions/upload-artifact': 7,
    'google-github-actions/auth': 3,
    'google-github-actions/setup-gcloud': 3,
    'actions/setup-java': 5,
    'treosh/lighthouse-ci-action': 12,
};

interface ActionUse {
    readonly file: string;
    readonly action: string;
    readonly major: number;
}

function collectUses(): readonly ActionUse[] {
    const found: ActionUse[] = [];
    for (const file of readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml'))) {
        const text = readFileSync(join(WORKFLOW_DIR, file), 'utf-8');
        for (const m of text.matchAll(/uses:\s*([\w./-]+)@v?(\d+)/g)) {
            found.push({ file, action: m[1] ?? '', major: Number(m[2]) });
        }
    }
    return found;
}

describe('workflow action runtimes', () => {
    const uses = collectUses();

    it('finds action references to check', () => {
        expect(uses.length).toBeGreaterThan(0);
    });

    it.each(Object.entries(MIN_MAJOR))('%s is at least v%i everywhere', (action, min) => {
        const stale = uses.filter((u) => u.action === action && u.major < min);
        expect(stale).toEqual([]);
    });
});
