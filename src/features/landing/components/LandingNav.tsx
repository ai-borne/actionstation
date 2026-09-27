/**
 * LandingNav — Sticky navigation bar for the public landing page.
 * Contains logo, section anchor links, and auth CTAs.
 * Includes a mobile hamburger menu via MobileMenu for viewports below md.
 */
import { useState } from 'react';
import { strings } from '@/shared/localization/strings';
import { BrandLogoIcon } from '@/shared/components/icons';
import { MobileMenu } from './MobileMenu';

const NAV_LINKS = [
    { label: strings.landing.nav.features, href: '#features' },
    { label: strings.landing.nav.pricing, href: '#pricing' },
    { label: strings.landing.nav.faq, href: '#faq' },
] as const;

/** Sticky top navigation for the landing page. */
export function LandingNav() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    return (
        <nav
            aria-label={strings.landing.nav.ariaLabel}
            className="sticky top-0 z-50 w-full relative backdrop-blur-md border-b border-[var(--color-border)]"
            style={{ backgroundColor: 'var(--color-background)' }}
        >
            <div
                className="flex items-center justify-between max-w-6xl"
                style={{ padding: 'var(--space-md) var(--space-xl)', marginLeft: 'auto', marginRight: 'auto' }}
            >
                {/* Logo */}
                <a
                    href="/"
                    className="flex items-center font-bold text-[var(--color-text-primary)] no-underline"
                    style={{ fontSize: 'var(--font-size-lg)', gap: 'var(--space-sm)' }}
                >
                    <BrandLogoIcon size={28} />
                    {strings.app.name}
                </a>

                {/* Desktop section anchors */}
                <div className="hidden md:flex items-center" style={{ gap: 'var(--space-lg)' }}>
                    {NAV_LINKS.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            className="text-[var(--color-text-secondary)] no-underline hover:text-[var(--color-text-primary)] transition-colors duration-150"
                            style={{ fontSize: 'var(--font-size-sm)' }}
                        >
                            {link.label}
                        </a>
                    ))}
                </div>

                {/* Desktop auth CTAs */}
                <div className="hidden md:flex items-center" style={{ gap: 'var(--space-md)' }}>
                    <a
                        href="/login"
                        className="text-[var(--color-text-secondary)] no-underline hover:text-[var(--color-text-primary)] transition-colors duration-150"
                        style={{ fontSize: 'var(--font-size-sm)' }}
                    >
                        {strings.landing.nav.login}
                    </a>
                    <a
                        href="/login"
                        className="inline-flex items-center justify-center no-underline rounded-lg transition-colors duration-150"
                        style={{ color: 'var(--color-text-on-primary)', padding: 'var(--space-sm) var(--space-lg)', fontSize: 'var(--font-size-sm)', background: 'var(--color-primary)' }}
                    >
                        {strings.landing.nav.getStarted}
                    </a>
                </div>

                {/* Mobile hamburger */}
                <button
                    type="button"
                    className="md:hidden text-[var(--color-text-primary)]"
                    style={{ fontSize: 'var(--font-size-xl)', background: 'none', border: 'none' }}
                    aria-expanded={isMenuOpen}
                    aria-label={isMenuOpen ? strings.landing.nav.closeMenu : strings.landing.nav.openMenu}
                    onClick={() => setIsMenuOpen((prev) => !prev)}
                >
                    {isMenuOpen ? strings.landing.nav.menuCloseIcon : strings.landing.nav.menuOpenIcon}
                </button>
            </div>

            <MobileMenu isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} navLinks={NAV_LINKS} />
        </nav>
    );
}
