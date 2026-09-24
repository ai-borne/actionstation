/**
 * LandingFooter — Footer for the public landing page.
 * Contains copyright, legal links, and tagline.
 */
import { strings } from '@/shared/localization/strings';
import { BrandLogoIcon } from '@/shared/components/icons';

/** Landing page footer with legal links and copyright. */
export function LandingFooter() {
    const copyright = strings.landing.footer.copyright(new Date().getFullYear());

    return (
        <footer
            role="contentinfo"
            className="w-full border-t border-[var(--color-border)]"
            style={{ padding: 'var(--space-2xl) var(--space-xl)' }}
        >
            <div
                className="flex flex-col md:flex-row items-center justify-between max-w-6xl"
                style={{ gap: 'var(--space-lg)', marginLeft: 'auto', marginRight: 'auto' }}
            >
                {/* Brand mark + tagline */}
                <div className="flex items-center" style={{ gap: 'var(--space-sm)' }}>
                    <BrandLogoIcon size={20} />
                    <p
                        className="text-[var(--color-text-muted)]"
                        style={{ fontSize: 'var(--font-size-sm)' }}
                    >
                        {strings.landing.footer.tagline}
                    </p>
                </div>

                {/* Legal links */}
                <div className="flex items-center" style={{ gap: 'var(--space-lg)' }}>
                    <a
                        href="/terms"
                        className="text-[var(--color-text-muted)] no-underline hover:text-[var(--color-text-primary)] transition-colors duration-150"
                        style={{ fontSize: 'var(--font-size-sm)' }}
                    >
                        {strings.landing.footer.terms}
                    </a>
                    <a
                        href="/privacy"
                        className="text-[var(--color-text-muted)] no-underline hover:text-[var(--color-text-primary)] transition-colors duration-150"
                        style={{ fontSize: 'var(--font-size-sm)' }}
                    >
                        {strings.landing.footer.privacy}
                    </a>
                    <a
                        href="/refund"
                        className="text-[var(--color-text-muted)] no-underline hover:text-[var(--color-text-primary)] transition-colors duration-150"
                        style={{ fontSize: 'var(--font-size-sm)' }}
                    >
                        {strings.landing.footer.refund}
                    </a>
                    <a
                        href="/contact"
                        className="text-[var(--color-text-muted)] no-underline hover:text-[var(--color-text-primary)] transition-colors duration-150"
                        style={{ fontSize: 'var(--font-size-sm)' }}
                    >
                        {strings.landing.footer.contact}
                    </a>
                </div>

                {/* Copyright */}
                <p
                    className="text-[var(--color-text-muted)]"
                    style={{ fontSize: 'var(--font-size-xs)' }}
                >
                    {copyright}
                </p>
            </div>
        </footer>
    );
}
