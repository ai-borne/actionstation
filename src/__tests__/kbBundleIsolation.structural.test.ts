/**
 * Structural test — KB bundle isolation
 *
 * Asserts that KB hooks AND upstream service files do NOT contain bare
 * top-level static imports of knowledgeBankService or storageService.
 *
 * Static imports pull the entire KB service tree into the initial bundle
 * even though KnowledgeBankPanel is lazy-loaded in Layout.tsx, defeating
 * Rollup's code-splitting for the KB feature chunk.
 *
 * Each call-site must use `await import(...)` inline so Rollup can defer
 * the KB service tree to a separate lazy chunk.
 *
 * See: docs/README.md
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOOKS_DIR = resolve(__dirname, '../features/knowledgeBank/hooks');
const SERVICES_DIR = resolve(__dirname, '../features/knowledgeBank/services');

const HOOKS = [
    'usePasteTextHandler.ts',
    'useDocumentGroupHandlers.ts',
    'useKnowledgeBankPanelHandlers.ts',
] as const;

/** Service files that previously had static imports of the KB service tree */
const SERVICES = [
    'parseResultPersister.ts',
    'postUploadSummarizer.ts',
    'summarizeEntries.ts',
] as const;

describe('KB bundle isolation — no top-level static imports of service modules in hooks', () => {
    for (const hook of HOOKS) {
        it(`${hook} does not statically import knowledgeBankService`, () => {
            const content = readFileSync(resolve(HOOKS_DIR, hook), 'utf-8');
            expect(
                content,
                `${hook} must not have a top-level "import ... from '../services/knowledgeBankService'" — use await import() inline instead`,
            ).not.toMatch(/^import .+ from ['"]\.\.\/services\/knowledgeBankService['"]/m);
        });

        it(`${hook} does not statically import storageService`, () => {
            const content = readFileSync(resolve(HOOKS_DIR, hook), 'utf-8');
            expect(
                content,
                `${hook} must not have a top-level "import ... from '../services/storageService'" — use await import() inline instead`,
            ).not.toMatch(/^import .+ from ['"]\.\.\/services\/storageService['"]/m);
        });
    }
});

describe('KB bundle isolation — no top-level static imports of service modules in upstream services', () => {
    for (const svc of SERVICES) {
        it(`${svc} does not statically import knowledgeBankService`, () => {
            const content = readFileSync(resolve(SERVICES_DIR, svc), 'utf-8');
            expect(
                content,
                `${svc} must not have a top-level "import ... from './knowledgeBankService'" — use await import() inline instead`,
            ).not.toMatch(/^import [^'"]+ from ['"]\.\/(knowledgeBankService|storageService)['"]/m);
        });
    }
});
