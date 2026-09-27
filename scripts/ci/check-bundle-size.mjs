#!/usr/bin/env node
// G13: fail when the JS a first visit downloads (entry script + modulepreloads, gzipped)
// exceeds the budget in perf-budgets.json. Usage: node check-bundle-size.mjs [distDir] [budgetsFile]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = process.argv[2] ?? 'dist';
const budgetsFile = process.argv[3] ?? 'perf-budgets.json';

const html = readFileSync(join(dist, 'index.html'), 'utf-8');
const entries = [
    ...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g),
    ...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g),
].map((m) => m[1]);

if (entries.length === 0) {
    console.error(`No entry script found in ${join(dist, 'index.html')}`);
    process.exit(1);
}

const bytes = entries.reduce((sum, url) => sum + gzipSync(readFileSync(join(dist, url))).length, 0);
const kb = bytes / 1024;
const { initialJsGzipKb: budget } = JSON.parse(readFileSync(budgetsFile, 'utf-8'));

console.log(`Initial JS (gzip): ${kb.toFixed(1)} kB across ${entries.length} files; budget ${budget} kB`);
if (kb > budget) {
    console.error(`Initial JS exceeds the budget by ${(kb - budget).toFixed(1)} kB. Trim the bundle, or raise perf-budgets.json with a reason.`);
    process.exit(1);
}
