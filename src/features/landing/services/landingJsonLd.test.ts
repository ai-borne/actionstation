import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildLandingJsonLd } from './landingJsonLd';
import { landingStrings } from '../strings/landingStrings';
import { PRO_ANNUAL_PRICE_INR } from '@/features/subscription/types/pricing';

describe('buildLandingJsonLd', () => {
    const [app, faq] = buildLandingJsonLd() as unknown as [Record<string, unknown>, Record<string, unknown>];

    it('describes the app with the real INR prices, not a hand-copied list', () => {
        expect(app['@type']).toBe('SoftwareApplication');
        const offers = app.offers as ReadonlyArray<{ price: string; priceCurrency: string; name: string }>;
        expect(offers.map((o) => [o.name, o.price, o.priceCurrency])).toEqual([
            ['Free', '0', 'INR'],
            ['Pro', String(PRO_ANNUAL_PRICE_INR), 'INR'],
        ]);
        expect(JSON.stringify(offers)).not.toContain('billingDuration'); // annual one-time purchase, not a monthly subscription
    });

    it('mirrors the visible FAQ exactly (Google requires the markup to match the page)', () => {
        expect(faq['@type']).toBe('FAQPage');
        const entities = faq.mainEntity as ReadonlyArray<{ name: string; acceptedAnswer: { text: string } }>;
        expect(entities.map((e) => [e.name, e.acceptedAnswer.text])).toEqual(
            landingStrings.faq.items.map((i) => [i.question, i.answer]),
        );
    });
});

describe('index.html', () => {
    it('carries no static JSON-LD (it drifted from the page before; the landing page renders it from the SSOT)', () => {
        const html = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');
        expect(html).not.toContain('application/ld+json');
    });
});
