/**
 * Structural test: the CSP must let Razorpay Standard Checkout run (checklist B14).
 *
 * checkout.js (script-src) opens the payment page in an iframe whose src is
 * https://api.razorpay.com/v1/checkout/public (frame-src) and talks to
 * https://api.razorpay.com (connect-src). Missing any of these leaves users
 * with a blank "This content is blocked" overlay instead of a payment window.
 * cdn.razorpay.com (risk detection) and lumberjack.razorpay.com (checkout telemetry) were
 * seen blocked in the production drill; both are Razorpay's own hosts, used only during checkout.
 * The general CSP test only covers connect-src, so this guards the rest.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

interface Header { key: string; value: string }
interface Rule { source: string; headers?: Header[] }

function directive(csp: string, name: string): string {
    const found = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
    return found ?? '';
}

function loadCsp(): string {
    const config = JSON.parse(readFileSync(join(process.cwd(), 'firebase.json'), 'utf8')) as {
        hosting?: { headers?: Rule[] };
    };
    const rules = config.hosting?.headers ?? [];
    for (const rule of rules) {
        const header = rule.headers?.find((h) => h.key.toLowerCase() === 'content-security-policy');
        if (header) return header.value;
    }
    return '';
}

describe('CSP allows Razorpay Standard Checkout', () => {
    const csp = loadCsp();

    it.each([
        ['frame-src', 'https://api.razorpay.com', 'the checkout iframe is served from api.razorpay.com'],
        ['frame-src', 'https://checkout.razorpay.com', 'checkout.js may frame its own host'],
        ['script-src', 'https://checkout.razorpay.com', 'checkout.js is loaded from checkout.razorpay.com'],
        ['connect-src', 'https://api.razorpay.com', 'checkout calls the Razorpay API'],
        ['script-src', 'https://cdn.razorpay.com', 'checkout.js loads its risk-detection bundle from cdn.razorpay.com'],
        ['connect-src', 'https://lumberjack.razorpay.com', 'checkout sends its telemetry to lumberjack.razorpay.com'],
    ])('%s includes %s (%s)', (name, host) => {
        expect(directive(csp, name), `${name} must include ${host}`).toContain(host);
    });
});
