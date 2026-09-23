/**
 * Platform Utility Tests - TDD
 * OS detection and modifier key display
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isMacOS, getModifierSymbol, formatShortcut, isSafari } from '../platform';

describe('Platform Utilities', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('isMacOS', () => {
        it('should return true via userAgentData on macOS', () => {
            vi.stubGlobal('navigator', {
                userAgentData: { platform: 'macOS' },
                userAgent: '',
            });
            expect(isMacOS()).toBe(true);
        });

        it('should return true via userAgent fallback on macOS', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            });
            expect(isMacOS()).toBe(true);
        });

        it('should return false on Windows', () => {
            vi.stubGlobal('navigator', {
                userAgentData: { platform: 'Windows' },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            });
            expect(isMacOS()).toBe(false);
        });

        it('should return false on Linux', () => {
            vi.stubGlobal('navigator', {
                userAgentData: { platform: 'Linux' },
                userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
            });
            expect(isMacOS()).toBe(false);
        });

        it('should return false when navigator is undefined', () => {
            vi.stubGlobal('navigator', undefined);
            expect(isMacOS()).toBe(false);
        });
    });

    describe('getModifierSymbol', () => {
        it('should return command symbol on macOS', () => {
            vi.stubGlobal('navigator', {
                userAgentData: { platform: 'macOS' },
                userAgent: '',
            });
            expect(getModifierSymbol()).toBe('⌘');
        });

        it('should return Ctrl on Windows', () => {
            vi.stubGlobal('navigator', {
                userAgentData: { platform: 'Windows' },
                userAgent: '',
            });
            expect(getModifierSymbol()).toBe('Ctrl');
        });

        it('should return Ctrl on Linux', () => {
            vi.stubGlobal('navigator', {
                userAgentData: { platform: 'Linux' },
                userAgent: '',
            });
            expect(getModifierSymbol()).toBe('Ctrl');
        });
    });

    describe('isSafari', () => {
        it('should return true for desktop Safari', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
            });
            expect(isSafari()).toBe(true);
        });

        it('should return true for iOS Safari', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
            });
            expect(isSafari()).toBe(true);
        });

        it('should return false for Chrome (also matches Safari UA substring)', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            });
            expect(isSafari()).toBe(false);
        });

        it('should return false for Chrome on iOS (CriOS)', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1',
            });
            expect(isSafari()).toBe(false);
        });

        it('should return false for Edge', () => {
            vi.stubGlobal('navigator', {
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
            });
            expect(isSafari()).toBe(false);
        });

        it('should return false when navigator is undefined', () => {
            vi.stubGlobal('navigator', undefined);
            expect(isSafari()).toBe(false);
        });
    });

    describe('formatShortcut', () => {
        it('should format modifier + key on macOS', () => {
            vi.stubGlobal('navigator', {
                userAgentData: { platform: 'macOS' },
                userAgent: '',
            });
            expect(formatShortcut(',')).toBe('⌘ ,');
        });

        it('should format modifier + key on Windows', () => {
            vi.stubGlobal('navigator', {
                userAgentData: { platform: 'Windows' },
                userAgent: '',
            });
            expect(formatShortcut(',')).toBe('Ctrl + ,');
        });

        it('should format key only when no modifier needed', () => {
            vi.stubGlobal('navigator', {
                userAgentData: { platform: 'macOS' },
                userAgent: '',
            });
            expect(formatShortcut('N', false)).toBe('N');
        });
    });
});
