/**
 * Structural test: rules must tolerate node/edge docs that have no `userId` field.
 *
 * Incident 2026-09-25: docs written before 2026-03-15 (before the userId guard was
 * added) have no `userId`. Reading a missing field inside a rule is an evaluation
 * error, so `!resource.data.userId || resource.data.userId == ...` errored on both
 * sides and DENIED every update. Any save touching such a doc failed atomically
 * ("Save failed"), and since the app never got to rewrite the doc, it never got a
 * userId either. 4 workspaces (24 nodes, 5 edges) were stuck.
 *
 * Fix: an extra `|| !('userId' in resource.data)` alternative (a true operand
 * absorbs the errors of the others). Verified against the deployed-rules test API
 * (see docs/launch/LAUNCH-EVIDENCE.md, F9); this test keeps the alternative in place.
 * The existing pinned guard string in firestoreRules.structural.test.ts is unchanged.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const RULES_PATH = path.resolve(__dirname, '..', '..', 'firestore.rules');
const MISSING_FIELD_ALTERNATIVE = "!('userId' in resource.data)";

describe('Firestore rules tolerate docs without a userId field', () => {
    const content = fs.readFileSync(RULES_PATH, 'utf-8');

    const sections: ReadonlyArray<readonly [string, string, string | undefined]> = [
        ['nodes', 'match /nodes/{nodeId}', 'match /edges/{edgeId}'],
        ['edges', 'match /edges/{edgeId}', 'match /tiles/{tileId}/nodes/{nodeId}'],
        ['tiles/nodes', 'match /tiles/{tileId}/nodes/{nodeId}', 'match /knowledgeBank/{entryId}'],
    ];

    it.each(sections)('%s write rule accepts an existing doc with no userId', (_name, from, to) => {
        const start = content.indexOf(from);
        expect(start, `${from} not found`).toBeGreaterThan(-1);
        const section = content.slice(start, to ? content.indexOf(to, start) : undefined);
        expect(section).toContain(MISSING_FIELD_ALTERNATIVE);
    });

    it('never relies on reading resource.data.userId alone to allow a legacy doc', () => {
        const guardedLines = content.split('\n').filter((l) => /(?<!request\.)resource\.data\.userId/.test(l));
        expect(guardedLines.length).toBeGreaterThan(0);
        for (const line of guardedLines) expect(line).toContain(MISSING_FIELD_ALTERNATIVE);
    });
});
