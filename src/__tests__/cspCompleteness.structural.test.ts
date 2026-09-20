/**
 * Structural test: CSP completeness
 *
 * Prevents regression of the Content-Security-Policy HTTP response header
 * defined in firebase.json hosting.headers.
 *
 * The CSP was migrated from an index.html <meta> tag to a response header so
 * that frame-ancestors is enforced (meta tags cannot express frame-ancestors).
 *
 * Ensures all required Firebase/Google domains are present in connect-src
 * and dangerous directives (unsafe-eval, bare wildcards) remain absent.
 *
 * If this test fails, someone modified the CSP without including all
 * required first-party Google domains — which will break AI generation,
 * Firestore saves, or auth flows.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll } from 'vitest';

const FIREBASE_JSON = join(process.cwd(), 'firebase.json');

interface FirebaseHeader { key: string; value: string }
interface FirebaseHeaderRule { source: string; headers?: FirebaseHeader[] }
interface FirebaseConfig {
    hosting?: { headers?: FirebaseHeaderRule[] };
}

/** Parse the Content-Security-Policy value from firebase.json hosting.headers */
function extractCsp(): string {
    const raw = readFileSync(FIREBASE_JSON, 'utf-8');
    const config = JSON.parse(raw) as FirebaseConfig;
    const rules = config.hosting?.headers ?? [];
    for (const rule of rules) {
        const cspHeader = rule.headers?.find(h => h.key === 'Content-Security-Policy');
        if (cspHeader?.value) return cspHeader.value;
    }
    throw new Error(
        'No Content-Security-Policy header found in firebase.json hosting.headers. ' +
        'Add it under hosting.headers[].headers with key "Content-Security-Policy".'
    );
}

/** Extract a specific directive's value from the full CSP string */
function getDirective(csp: string, name: string): string {
    // Use word boundary to avoid partial matches; handles first or mid-string directives
    const regex = new RegExp(`(?:^|;\\s*)${name}\\s+([^;]+)`);
    const match = regex.exec(csp);
    return match?.[1]?.trim() ?? '';
}

describe('CSP Completeness (firebase.json)', () => {
    let csp: string;
    let connectSrc: string;

    beforeAll(() => {
        csp = extractCsp();
        connectSrc = getDirective(csp, 'connect-src');
    });

    it('should have a CSP header in firebase.json hosting.headers', () => {
        expect(csp.length).toBeGreaterThan(0);
    });

    // ── connect-src: required domains ────────────────────

    describe('connect-src contains all required Firebase/Google domains', () => {
        const requiredDomains = [
            { domain: 'https://generativelanguage.googleapis.com', reason: 'Gemini AI API' },
            { domain: 'https://firestore.googleapis.com', reason: 'Firestore REST' },
            { domain: 'https://*.firebaseio.com', reason: 'Firestore WebChannel transport' },
            { domain: 'wss://*.firebaseio.com', reason: 'Firestore WebSocket transport' },
            { domain: 'https://identitytoolkit.googleapis.com', reason: 'Firebase Auth sign-in' },
            { domain: 'https://securetoken.googleapis.com', reason: 'Firebase Auth token refresh' },
            { domain: 'https://*.cloudfunctions.net', reason: 'Cloud Functions proxy' },
            { domain: 'https://www.googleapis.com', reason: 'Google APIs (Calendar, etc.)' },
            { domain: 'https://oauth2.googleapis.com', reason: 'OAuth2 token exchange' },
            { domain: 'https://firebasestorage.googleapis.com', reason: 'Firebase Storage upload API' },
            { domain: 'https://*.firebasestorage.app', reason: 'Firebase Storage download URLs' },
            { domain: 'https://api.razorpay.com', reason: 'Razorpay payment API' },
            { domain: 'https://checkout.razorpay.com', reason: 'Razorpay checkout script / API' },
            { domain: 'https://challenges.cloudflare.com', reason: 'Cloudflare Turnstile CAPTCHA' },
        ];

        it.each(requiredDomains)(
            'includes $domain ($reason)',
            ({ domain }) => {
                // Accept exact domain OR wildcard *.googleapis.com coverage
                const covered =
                    connectSrc.includes(domain) ||
                    (domain.endsWith('.googleapis.com') && connectSrc.includes('https://*.googleapis.com'));
                expect(
                    covered,
                    `connect-src is missing "${domain}" (and no *.googleapis.com wildcard). ` +
                    'Add it to the Content-Security-Policy header in firebase.json hosting.headers.'
                ).toBe(true);
            }
        );
    });

    // ── img-src: required sources for image features ──────

    describe('img-src allows sources needed by image features', () => {
        const requiredSources = [
            { source: 'blob:', reason: 'imageCompressor uses URL.createObjectURL for canvas processing' },
            { source: 'data:', reason: 'progressive upload inserts base64 placeholder images' },
        ];

        it.each(requiredSources)(
            'includes $source ($reason)',
            ({ source }) => {
                const imgSrc = getDirective(csp, 'img-src');
                expect(
                    imgSrc,
                    `img-src is missing "${source}". ` +
                    'Add it to the Content-Security-Policy header in firebase.json hosting.headers.',
                ).toContain(source);
            },
        );
    });

    // ── frame-src: Google Sign-In popup ──────────────────

    it('frame-src allows accounts.google.com for Google Sign-In', () => {
        const frameSrc = getDirective(csp, 'frame-src');
        expect(
            frameSrc,
            'frame-src must allow https://accounts.google.com for Google Sign-In popup. ' +
            "Using 'none' breaks authentication."
        ).toContain('https://accounts.google.com');
    });

    // ── frame-ancestors: clickjacking protection ──────────
    // Note: meta tag CSP cannot enforce frame-ancestors; this MUST be a response header.

    it("frame-ancestors is 'none' (blocks clickjacking)", () => {
        const frameAncestors = getDirective(csp, 'frame-ancestors');
        expect(
            frameAncestors,
            "frame-ancestors must be 'none'. " +
            'This requires a response-header CSP (firebase.json) — meta tags cannot enforce frame-ancestors. ' +
            "If missing, the app is vulnerable to clickjacking."
        ).toContain("'none'");
    });

    // ── worker-src: Sentry replay worker support ──────────

    describe('worker-src allows blob: for Sentry replay workers', () => {
        it('includes blob: (required for Sentry replayIntegration Web Worker)', () => {
            const workerSrc = getDirective(csp, 'worker-src');
            expect(
                workerSrc,
                'worker-src is missing "blob:". Sentry replayIntegration creates Web Workers ' +
                'from blob: URLs. Without worker-src, the CSP falls back to script-src which blocks blob:.',
            ).toContain('blob:');
        });

        it("includes 'self' as baseline", () => {
            const workerSrc = getDirective(csp, 'worker-src');
            expect(workerSrc).toContain("'self'");
        });

        it('does NOT contain unsafe-eval', () => {
            const workerSrc = getDirective(csp, 'worker-src');
            expect(
                workerSrc,
                "worker-src must NOT contain 'unsafe-eval'",
            ).not.toContain("'unsafe-eval'");
        });
    });

    // ── Security guardrails (negative assertions) ────────

    describe('security guardrails remain in place', () => {
        it('script-src does NOT contain unsafe-eval', () => {
            const scriptSrc = getDirective(csp, 'script-src');
            expect(
                scriptSrc,
                "script-src must NOT contain 'unsafe-eval' — it allows arbitrary code execution"
            ).not.toContain("'unsafe-eval'");
        });

        it('connect-src does NOT contain bare wildcard *', () => {
            // Split to avoid matching *.firebaseio.com etc.
            const entries = connectSrc.split(/\s+/);
            const hasBareWildcard = entries.some((e) => e === '*');
            expect(
                hasBareWildcard,
                'connect-src must NOT contain bare wildcard * — it allows data exfiltration to any server'
            ).toBe(false);
        });

        it('object-src is none (blocks plugin injection)', () => {
            const objectSrc = getDirective(csp, 'object-src');
            expect(objectSrc).toContain("'none'");
        });

        it('base-uri is self (blocks base tag hijacking)', () => {
            const baseUri = getDirective(csp, 'base-uri');
            expect(baseUri).toContain("'self'");
        });

        it('default-src is self', () => {
            const defaultSrc = getDirective(csp, 'default-src');
            expect(defaultSrc).toContain("'self'");
        });
    });
});

describe('HTTP Security Headers (firebase.json)', () => {
    let allHeaders: FirebaseHeader[];

    beforeAll(() => {
        const raw = readFileSync(FIREBASE_JSON, 'utf-8');
        const config = JSON.parse(raw) as FirebaseConfig;
        const rules = config.hosting?.headers ?? [];
        const catchAll = rules.find(r => r.source === '**');
        allHeaders = catchAll?.headers ?? [];
    });

    /** Find a header by key (case-insensitive) */
    function findHeader(key: string): FirebaseHeader | undefined {
        return allHeaders.find(h => h.key.toLowerCase() === key.toLowerCase());
    }

    it('has Strict-Transport-Security with max-age', () => {
        const hsts = findHeader('Strict-Transport-Security');
        expect(hsts, 'Missing Strict-Transport-Security header — HSTS prevents downgrade attacks').toBeDefined();
        expect(hsts!.value).toContain('max-age=');
    });

    it('has X-Frame-Options set to DENY', () => {
        const xfo = findHeader('X-Frame-Options');
        expect(xfo, 'Missing X-Frame-Options header — prevents clickjacking').toBeDefined();
        expect(xfo!.value).toBe('DENY');
    });

    it('has Referrer-Policy set to strict-origin-when-cross-origin', () => {
        const rp = findHeader('Referrer-Policy');
        expect(rp, 'Missing Referrer-Policy header — prevents referrer leakage').toBeDefined();
        expect(rp!.value).toContain('strict-origin');
    });

    it('has Permissions-Policy restricting camera, microphone, geolocation', () => {
        const pp = findHeader('Permissions-Policy');
        expect(pp, 'Missing Permissions-Policy header — restricts browser API access').toBeDefined();
        expect(pp!.value).toContain('camera=()');
        expect(pp!.value).toContain('microphone=()');
        expect(pp!.value).toContain('geolocation=()');
    });

    it('has X-Content-Type-Options set to nosniff', () => {
        const xcto = findHeader('X-Content-Type-Options');
        expect(xcto, 'Missing X-Content-Type-Options header — prevents MIME sniffing').toBeDefined();
        expect(xcto!.value).toBe('nosniff');
    });

    it('has Content-Security-Policy header', () => {
        const cspHeader = findHeader('Content-Security-Policy');
        expect(cspHeader, 'Missing Content-Security-Policy header').toBeDefined();
        expect(cspHeader!.value).toContain('default-src');
    });

    it('has Cross-Origin-Opener-Policy set to same-origin-allow-popups', () => {
        // Required for signInWithPopup: allows Google OAuth popup to communicate back.
        // Without this, Chrome blocks window.closed checks on the popup → auth fails.
        const coop = findHeader('Cross-Origin-Opener-Policy');
        expect(coop, 'Missing Cross-Origin-Opener-Policy header — required for Google sign-in popup').toBeDefined();
        expect(coop!.value).toBe('same-origin-allow-popups');
    });

    it('has at least 7 security headers on the catch-all rule', () => {
        expect(allHeaders.length).toBeGreaterThanOrEqual(7);
    });
});
