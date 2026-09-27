/**
 * landingJsonLd — structured data for the landing page, built from the same
 * constants and strings the page renders so it cannot drift from what visitors see.
 */
import { landingStrings } from '../strings/landingStrings';
import { PRO_ANNUAL_PRICE_INR } from '@/features/subscription/types/pricing';
import { SITE_ORIGIN } from '@/config/site';

const CURRENCY = 'INR';

/** A schema.org object; `@type` doubles as its React key. */
export interface LandingJsonLdObject {
    readonly '@type': string;
    readonly [key: string]: unknown;
}

/** SoftwareApplication + FAQPage JSON-LD objects for the landing page. */
export function buildLandingJsonLd(): readonly LandingJsonLdObject[] {
    return [
        {
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: landingStrings.seo.siteName,
            description: landingStrings.seo.description,
            applicationCategory: 'ProductivityApplication',
            operatingSystem: 'Web',
            url: SITE_ORIGIN,
            offers: [
                { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: CURRENCY },
                { '@type': 'Offer', name: 'Pro', price: String(PRO_ANNUAL_PRICE_INR), priceCurrency: CURRENCY },
            ],
        },
        {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: landingStrings.faq.items.map((item) => ({
                '@type': 'Question',
                name: item.question,
                acceptedAnswer: { '@type': 'Answer', text: item.answer },
            })),
        },
    ];
}
