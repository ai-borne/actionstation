/**
 * Structural test: deploy.yml env var completeness
 *
 * Ensures the GitHub Actions deploy workflow references all required
 * environment variables from envValidation.ts. If a new var is added
 * to REQUIRED_VARS in envValidation.ts, this test will automatically
 * fail until deploy.yml is updated — no manual sync required.
 *
 * SSOT: REQUIRED_VARS are extracted by parsing src/config/envValidation.ts
 * at test time, not duplicated here.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll } from 'vitest';

const ROOT = process.cwd();
const DEPLOY_YML_PATH = join(ROOT, '.github', 'workflows', 'deploy.yml');
const ENV_VALIDATION_PATH = join(ROOT, 'src', 'config', 'envValidation.ts');

/**
 * Parse REQUIRED_VARS from envValidation.ts at test time.
 * Extracts string literals from the `const REQUIRED_VARS = [...]` array.
 */
function parseRequiredVars(source: string): string[] {
    const match = /const REQUIRED_VARS\s*=\s*\[([\s\S]*?)\]\s*as\s*const/.exec(source);
    if (!match?.[1]) throw new Error('Could not find REQUIRED_VARS in envValidation.ts');
    return [...match[1].matchAll(/'(VITE_[^']+)'/g)]
        .map(m => m[1])
        .filter((v): v is string => v !== undefined);
}

describe('deploy.yml env var completeness', () => {
    let deployYml: string;
    let requiredVars: string[];

    beforeAll(() => {
        deployYml = readFileSync(DEPLOY_YML_PATH, 'utf-8');
        requiredVars = parseRequiredVars(readFileSync(ENV_VALIDATION_PATH, 'utf-8'));
    });

    it('parses at least one required var from envValidation.ts (sanity check)', () => {
        expect(requiredVars.length).toBeGreaterThan(0);
    });

    it('references all REQUIRED_VARS from envValidation.ts in the Build step', () => {
        const missing = requiredVars.filter(v => !deployYml.includes(v));
        expect(
            missing,
            `deploy.yml is missing these vars from envValidation.ts: ${missing.join(', ')}. ` +
            'Add them to the Build step env block.',
        ).toHaveLength(0);
    });

    it('sets VITE_APP_ENV to production', () => {
        expect(deployYml).toContain('VITE_APP_ENV: production');
    });

    it('does not contain VITE_GEMINI_API_KEY (must not reach production)', () => {
        // VITE_GEMINI_API_KEY is dev-only; production uses geminiProxy Cloud Function
        expect(deployYml).not.toContain('VITE_GEMINI_API_KEY');
    });

    it('does not contain VITE_DEV_BYPASS_SUBSCRIPTION', () => {
        expect(deployYml).not.toContain('VITE_DEV_BYPASS_SUBSCRIPTION');
    });

    it('deploys Firestore and Storage security rules', () => {
        expect(deployYml).toContain('firestore:rules');
        expect(deployYml).toContain('storage:rules');
    });

    it('runs Cloud Functions check before deploy', () => {
        expect(deployYml).toContain('working-directory: functions');
        expect(deployYml).toMatch(/working-directory: functions[\s\S]*npm run check/);
    });
});

