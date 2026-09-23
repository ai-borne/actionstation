/**
 * Structural test: Domain / CORS configuration consistency
 *
 * Ensures that corsConfig.ts imports from domainConfig.ts (SSOT)
 * and does not contain hardcoded domain strings.
 *
 * Also verifies that firebase.json CSP connect-src includes 'self'
 * (which covers all production hosting domains) and that the CSP
 * frame-src includes the Firebase auth domain for OAuth popups.
 *
 * If this test fails, someone hardcoded domains in corsConfig.ts
 * instead of using the domainConfig.ts SSOT.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll } from 'vitest';

const ROOT = process.cwd();
const FIREBASE_JSON_PATH = join(ROOT, 'firebase.json');
const DOMAIN_CONFIG_PATH = join(ROOT, 'functions', 'src', 'utils', 'domainConfig.ts');
const CORS_CONFIG_PATH = join(ROOT, 'functions', 'src', 'utils', 'corsConfig.ts');

interface FirebaseHeader { key: string; value: string }
interface FirebaseHeaderRule { source: string; headers?: FirebaseHeader[] }
interface FirebaseConfig {
    hosting?: { headers?: FirebaseHeaderRule[] };
}

/** Extract CSP value from firebase.json */
function extractCsp(): string {
    const raw = readFileSync(FIREBASE_JSON_PATH, 'utf-8');
    const config = JSON.parse(raw) as FirebaseConfig;
    const rules = config.hosting?.headers ?? [];
    for (const rule of rules) {
        const cspHeader = rule.headers?.find(h => h.key === 'Content-Security-Policy');
        if (cspHeader?.value) return cspHeader.value;
    }
    return '';
}

/** Extract a specific directive's value from the full CSP string */
function getDirective(csp: string, name: string): string {
    const regex = new RegExp(`(?:^|;\\s*)${name}\\s+([^;]+)`);
    const match = regex.exec(csp);
    return match?.[1]?.trim() ?? '';
}

describe('Domain / CORS / CSP consistency', () => {
    let domainConfigSrc: string;
    let corsConfigSrc: string;
    let csp: string;

    beforeAll(() => {
        domainConfigSrc = readFileSync(DOMAIN_CONFIG_PATH, 'utf-8');
        corsConfigSrc = readFileSync(CORS_CONFIG_PATH, 'utf-8');
        csp = extractCsp();
    });

    describe('domainConfig.ts SSOT', () => {
        it('has at least one production domain', () => {
            const domains = domainConfigSrc.match(/https:\/\/[a-zA-Z0-9._-]+/g) ?? [];
            expect(domains.length).toBeGreaterThan(0);
        });

        it('includes the Firebase web.app domain', () => {
            expect(domainConfigSrc).toContain('actionstation-244f0.web.app');
        });

        it('includes the Firebase firebaseapp.com domain', () => {
            expect(domainConfigSrc).toContain('actionstation-244f0.firebaseapp.com');
        });

        it('includes the custom production domain', () => {
            expect(domainConfigSrc).toContain('www.actionstation.in');
        });
    });

    describe('corsConfig.ts imports from SSOT', () => {
        it('imports PRODUCTION_DOMAINS from domainConfig', () => {
            expect(corsConfigSrc).toContain("from './domainConfig.js'");
        });

        it('does not contain hardcoded production domains', () => {
            const hardcoded = corsConfigSrc.match(/https:\/\/actionstation[a-zA-Z0-9._-]*/g) ?? [];
            expect(
                hardcoded.length,
                'corsConfig.ts should not contain hardcoded production domains — import from domainConfig.ts',
            ).toBe(0);
        });

        it('does not contain hardcoded localhost origins', () => {
            const hardcoded = corsConfigSrc.match(/http:\/\/localhost:\d+/g) ?? [];
            expect(
                hardcoded.length,
                'corsConfig.ts should not contain hardcoded localhost origins — import from domainConfig.ts',
            ).toBe(0);
        });
    });

    describe('firebase.json CSP covers hosting domains', () => {
        it('connect-src includes self (covers all hosting domains)', () => {
            const connectSrc = getDirective(csp, 'connect-src');
            expect(connectSrc).toContain("'self'");
        });

        it('frame-src includes Firebase auth domain for OAuth popups', () => {
            const frameSrc = getDirective(csp, 'frame-src');
            expect(frameSrc).toContain('auth.actionstation.in');
        });
    });
});
