/**
 * pageSeo — per-route <title>, canonical URL and robots for the public pages.
 * The app is a SPA with one index.html, so without this every route claims to be
 * the landing page. Routes not listed here (login, the signed-in app) are noindex.
 */
import { strings } from '@/shared/localization/strings';
import { SITE_ORIGIN } from '@/config/site';

const SITE = strings.landing.seo.siteName;

const PUBLIC_PAGES: ReadonlyMap<string, string> = new Map([
    ['/', strings.landing.seo.landingTitle],
    ['/terms', `${strings.legal.termsTitle} - ${SITE}`],
    ['/privacy', `${strings.legal.privacyTitle} - ${SITE}`],
    ['/refund', `${strings.legal.refundTitle} - ${SITE}`],
    ['/contact', `${strings.legal.contactTitle} - ${SITE}`],
]);

function setHeadTag(selector: string, tag: 'link' | 'meta', attrs: Readonly<Record<string, string>> | null): void {
    const existing = document.head.querySelector(selector);
    if (attrs === null) {
        existing?.remove();
        return;
    }
    const el = existing ?? document.head.appendChild(document.createElement(tag));
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
}

/** Point the document's title, canonical and robots tags at `pathname`. */
export function applyPageSeo(pathname: string): void {
    const title = PUBLIC_PAGES.get(pathname);
    if (title === undefined) {
        setHeadTag('link[rel="canonical"]', 'link', null);
        setHeadTag('meta[name="robots"]', 'meta', { name: 'robots', content: 'noindex' });
        return;
    }
    document.title = title;
    setHeadTag('link[rel="canonical"]', 'link', { rel: 'canonical', href: `${SITE_ORIGIN}${pathname}` });
    setHeadTag('meta[name="robots"]', 'meta', null);
}
