/**
 * Structural test: sign-in must never request a sensitive Google scope.
 *
 * Sensitive scopes (Calendar, Drive, Gmail, ...) on an unverified OAuth app show
 * Google's "hasn't verified this app" warning to every new user and cap the app at
 * 100 users. They are only requested on an explicit opt-in (Connect Calendar), through
 * the server-side flow in calendarAuthService.ts (checklist A10).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(__dirname, '..');
const LOGIN_FILES = ['config/firebase.ts', 'features/auth/services/authService.ts'];
const SENSITIVE_SCOPE = /googleapis\.com\/auth\/(?!userinfo\.(email|profile)\b)/;

function read(relative: string): string {
    return fs.readFileSync(path.join(SRC_DIR, relative), 'utf8');
}

describe('No sensitive Google scope at sign-in', () => {
    it.each(LOGIN_FILES)('%s requests no addScope() and names no sensitive scope', (file) => {
        const source = read(file);
        expect(source).not.toMatch(/\.addScope\(/);
        expect(source).not.toMatch(SENSITIVE_SCOPE);
    });

    it('Connect Calendar requests only the narrow calendar.events.owned scope via the server-side flow', () => {
        const source = read('features/auth/services/calendarAuthService.ts');
        // We only touch the user's primary (owned) calendar, so ask for the narrowest scope that covers it.
        expect(source).toContain("'https://www.googleapis.com/auth/calendar.events.owned'");
        expect(source).not.toMatch(/auth\/calendar(\.events)?'/);
        expect(source).toMatch(/access_type: 'offline'/);
    });
});
