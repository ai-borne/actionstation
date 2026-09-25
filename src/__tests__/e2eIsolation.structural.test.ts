/**
 * Structural test: the Playwright suite must stay isolated from production (checklist G12).
 *
 * The app connects to Firebase emulators only in Vite's `e2e` mode. These checks make sure no
 * deploy path builds in that mode, the emulator ports match firebase.json, and the suite pins
 * the flags a developer's `.env.local` could otherwise flip (a local dev-bypass made every
 * test user Pro once).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { EMULATOR_MODE, EMULATOR_PORTS } from '@/config/firebaseEmulators';

const read = (...parts: string[]): string => readFileSync(join(process.cwd(), ...parts), 'utf-8');

describe('e2e isolation', () => {
    it('no deploy or preview workflow builds in e2e mode', () => {
        for (const file of ['deploy.yml', 'preview.yml', 'lighthouse.yml']) {
            expect(read('.github', 'workflows', file), file).not.toMatch(/--mode\s+e2e|VITE_MODE=e2e/);
        }
    });

    it('no npm script other than the e2e runner uses e2e mode', () => {
        const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
        for (const [name, command] of Object.entries(scripts)) {
            if (name.startsWith('e2e')) continue;
            expect(command, name).not.toMatch(/--mode\s+e2e/);
        }
    });

    it('the mode name matches the one the Playwright web server passes to Vite', () => {
        expect(read('playwright.config.ts')).toContain(`--mode ${EMULATOR_MODE}`);
    });

    it('emulator ports match the emulators block in firebase.json', () => {
        const emulators = (JSON.parse(read('firebase.json')) as { emulators: Record<string, { port: number }> }).emulators;
        for (const [service, port] of Object.entries(EMULATOR_PORTS)) {
            expect(emulators[service]?.port, service).toBe(port);
        }
    });

    it('the e2e script uses the same firebase-tools version as CI', () => {
        const pinned = /FIREBASE_TOOLS_VERSION:\s*'([^']+)'/.exec(read('.github', 'workflows', 'ci.yml'))?.[1];
        const script = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts.e2e;
        expect(pinned).toBeDefined();
        expect(script).toContain(`firebase-tools@${pinned}`);
    });

    it('the suite pins the flags a local .env.local could change', () => {
        const config = read('playwright.config.ts');
        expect(config).toMatch(/VITE_DEV_BYPASS_SUBSCRIPTION:\s*'false'/);
        expect(config).toMatch(/VITE_TURNSTILE_SITE_KEY:\s*''/);
        expect(config).toContain("VITE_FIREBASE_PROJECT_ID: PROJECT_ID");
        expect(config).toMatch(/PROJECT_ID = 'demo-/);
    });
});
