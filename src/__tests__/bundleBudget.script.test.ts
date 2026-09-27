/**
 * scripts/ci/check-bundle-size.mjs — G13: fails when the JS a first visit must
 * download (entry script + modulepreloads, gzipped) exceeds perf-budgets.json.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { gzipSync } from 'zlib';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const SCRIPT = join(process.cwd(), 'scripts', 'ci', 'check-bundle-size.mjs');
const BUDGETS = join(process.cwd(), 'perf-budgets.json');

let dist: string;

function writeAsset(name: string, bytes: number): number {
    // Random bytes so gzip cannot shrink them.
    const body = randomBytes(bytes);
    writeFileSync(join(dist, 'assets', name), body);
    return gzipSync(body).length;
}

function run(budgetKb: number): { status: number | null; out: string } {
    const budgets = join(dist, 'budgets.json');
    writeFileSync(budgets, JSON.stringify({ initialJsGzipKb: budgetKb }));
    const r = spawnSync('node', [SCRIPT, dist, budgets], { encoding: 'utf-8' });
    return { status: r.status, out: r.stdout + r.stderr };
}

beforeEach(() => {
    dist = mkdtempSync(join(tmpdir(), 'bundle-'));
    mkdirSync(join(dist, 'assets'));
    writeAsset('entry.js', 4000);
    writeAsset('vendor.js', 3000);
    writeAsset('lazy.js', 50_000); // not referenced by index.html: must not count
    writeFileSync(join(dist, 'index.html'), [
        '<script type="module" crossorigin src="/assets/entry.js"></script>',
        '<link rel="modulepreload" crossorigin href="/assets/vendor.js">',
    ].join('\n'));
});

afterEach(() => rmSync(dist, { recursive: true, force: true }));

describe('check-bundle-size', () => {
    it('passes when entry + preloaded chunks fit the budget, ignoring lazy chunks', () => {
        const r = run(20);
        expect(r.status).toBe(0);
        expect(r.out).toMatch(/initial JS/i);
    });

    it('fails when the budget is exceeded', () => {
        const r = run(1);
        expect(r.status).toBe(1);
        expect(r.out).toMatch(/exceeds/i);
    });

    it('fails when index.html references no entry script', () => {
        writeFileSync(join(dist, 'index.html'), '<html></html>');
        expect(run(20).status).toBe(1);
    });
});

describe('perf-budgets.json', () => {
    it('defines a positive initial JS budget', () => {
        const budgets = JSON.parse(readFileSync(BUDGETS, 'utf-8')) as { initialJsGzipKb: number };
        expect(budgets.initialJsGzipKb).toBeGreaterThan(0);
    });
});
