/**
 * Platform Utilities - OS detection and keyboard modifier symbols
 * Used for platform-aware keyboard shortcut display
 */

/** NavigatorUAData interface for modern userAgentData API */
interface NavigatorUAData {
    readonly platform: string;
}

/** Detect if the current platform is macOS */
export function isMacOS(): boolean {
    if (typeof navigator === 'undefined') return false;

    // Modern API (Chromium 90+)
    const uaData = (navigator as unknown as { userAgentData?: NavigatorUAData }).userAgentData;
    if (uaData?.platform) {
        return uaData.platform === 'macOS';
    }

    // Fallback: check userAgent string
    return navigator.userAgent.includes('Mac');
}

/**
 * Detect Safari/WebKit (desktop or iOS).
 * Used to route around browser-specific auth popup/ITP quirks.
 */
export function isSafari(): boolean {
    if (typeof navigator === 'undefined') return false;

    const ua = navigator.userAgent;
    const otherBrowsers = ['Chrome', 'Chromium', 'CriOS', 'Edg', 'FxiOS', 'OPR'];
    return ua.includes('Safari') && !otherBrowsers.some((name) => ua.includes(name));
}

/** Get the platform-appropriate modifier key symbol */
export function getModifierSymbol(): string {
    return isMacOS() ? '⌘' : 'Ctrl';
}

/**
 * Format a keyboard shortcut for display
 * @param key - The key character (e.g. ',', 'N')
 * @param withModifier - Whether to include the platform modifier (default: true)
 */
export function formatShortcut(key: string, withModifier = true): string {
    if (!withModifier) return key;
    const mod = getModifierSymbol();
    const separator = isMacOS() ? ' ' : ' + ';
    return `${mod}${separator}${key}`;
}
