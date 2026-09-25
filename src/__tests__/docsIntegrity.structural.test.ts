/**
 * Structural test: docs stay navigable and honest.
 * - every doc under docs/ and plans/ declares a status line near the top
 * - "Current" docs carry a Last reconciled date that is not older than MAX_AGE_DAYS
 * - every doc under docs/ is listed in docs/README.md
 * - repo paths that "Current" docs mention in backticks or links still exist
 * A failure means: re-verify the doc against the code or live system, then update its date.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const DOC_ROOTS = ['docs', 'plans'];
const MAX_AGE_DAYS = 90;
const DAY_MS = 86_400_000;
const HEAD_LINES = 20;
const PATH_PREFIXES = ['docs/', 'src/', 'functions/', 'scripts/', 'plans/', '.github/'];
const ROOT_FILES = new Set(['firebase.json', 'firestore.rules', 'storage.rules', 'CLAUDE.md']);

const STATUS_DATE = /Status:\s*\**\s*Current\b[^\n]*?Last reconciled:\s*\**\s*(\d{4}-\d{2}-\d{2})/i;
const DATE_ONLY = /Last reconciled:\s*\**\s*(\d{4}-\d{2}-\d{2})/i;
const STATUS_OTHER = /Status:\s*\**\s*(Historical|Proposal|Superseded)/i;

function collect(dir: string, out: string[] = []): string[] {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return out;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) collect(rel, out);
        else if (e.name.endsWith('.md')) out.push(rel);
    }
    return out;
}

const docs = DOC_ROOTS.flatMap((d) => collect(d));
const head = (rel: string): string => {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
    return text.split('\n').slice(0, HEAD_LINES).join('\n');
};
const reconciledDate = (rel: string): string | null => {
    const h = head(rel);
    return (STATUS_DATE.exec(h) ?? DATE_ONLY.exec(h))?.[1] ?? null;
};
const isHistorical = (rel: string): boolean => STATUS_OTHER.test(head(rel));
const currentDocs = docs.filter((d) => !isHistorical(d) && !d.endsWith('README.md'));

function referencedPaths(rel: string): string[] {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const tokens = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '');
    return tokens
        .map((t) => t.replace(/:\d+(-\d+)?$/, '').replace(/[.,;]$/, ''))
        .filter((t) => !/[*<>{}…\s$]/.test(t))
        .filter((t) => PATH_PREFIXES.some((p) => t.startsWith(p)) || ROOT_FILES.has(t))
        .filter((t) => /\.[a-z]+$|\/$/.test(t));
}

describe('docs integrity', () => {
    it('finds docs to check', () => {
        expect(docs.length).toBeGreaterThan(10);
    });

    it.each(docs)('%s declares a status line', (rel) => {
        expect(reconciledDate(rel) !== null || isHistorical(rel)).toBe(true);
    });

    it.each(currentDocs)('%s was reconciled within the last 90 days', (rel) => {
        const date = reconciledDate(rel);
        expect(date, `${rel}: add "Last reconciled: YYYY-MM-DD"`).not.toBeNull();
        const age = (Date.now() - new Date(`${date}T00:00:00Z`).getTime()) / DAY_MS;
        expect(age, `${rel} is ${Math.floor(age)} days old: re-verify it, then update the date`).toBeLessThanOrEqual(MAX_AGE_DAYS);
        expect(age, `${rel}: date is in the future`).toBeGreaterThanOrEqual(-1);
    });

    it('lists every doc under docs/ in docs/README.md', () => {
        const readme = fs.readFileSync(path.join(ROOT, 'docs/README.md'), 'utf8');
        const missing = docs
            .filter((d) => d.startsWith('docs/') && d !== 'docs/README.md')
            .filter((d) => !readme.includes(d.slice('docs/'.length)) && !readme.includes(path.basename(d)));
        expect(missing, `add these to docs/README.md: ${missing.join(', ')}`).toEqual([]);
    });

    it('only references repo paths that exist in current docs', () => {
        const broken = currentDocs.flatMap((d) =>
            referencedPaths(d)
                .filter((p) => !fs.existsSync(path.join(ROOT, p)))
                .map((p) => `${d} -> ${p}`),
        );
        expect(broken).toEqual([]);
    });

    it('CLAUDE.md points at the docs map and the launch checklist', () => {
        const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
        expect(claude).toContain('docs/README.md');
        expect(claude).toContain('docs/launch/LAUNCH-CHECKLIST.md');
    });
});
