/**
 * Structural guard: one Gemini model id, on the stable (non-preview) channel.
 * The server (`functions/src/utils/securityConstants.ts`) decides which model production
 * calls; the dev-only direct client must name the same one. Preview ids are deprecated
 * without much notice, which would break every AI feature (checklist C15).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');
const EXPECTED_MODEL = 'gemini-3.1-flash-lite';

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (name === 'node_modules' || name === '__tests__' || name === 'lib') return [];
        if (statSync(full).isDirectory()) return sourceFiles(full);
        return /\.tsx?$/.test(name) && !/\.(test|structural)\./.test(name) ? [full] : [];
    });
}

describe('Gemini model (server vs dev-only client)', () => {
    it('the server calls the stable model', () => {
        const match = /GEMINI_MODEL\s*=\s*'([^']+)'/.exec(read('functions/src/utils/securityConstants.ts'));
        expect(match?.[1]).toBe(EXPECTED_MODEL);
    });

    it('the direct client names the same model through one constant, not an inline literal', () => {
        const source = read('src/features/knowledgeBank/services/geminiClient.ts');
        const match = /const DIRECT_MODEL\s*=\s*'([^']+)'/.exec(source);
        expect(match?.[1]).toBe(EXPECTED_MODEL);
        expect(source).toContain('${DIRECT_MODEL}:generateContent');
        expect(source.match(/gemini-[0-9][\w.-]*/g)).toEqual([EXPECTED_MODEL]);
    });

    it('no preview Gemini model id remains in production code', () => {
        const offenders = [...sourceFiles(resolve(ROOT, 'src')), ...sourceFiles(resolve(ROOT, 'functions/src'))]
            .filter((file) => /gemini-[\w.-]*-preview/.test(readFileSync(file, 'utf8')));
        expect(offenders).toEqual([]);
    });
});
