/**
 * HeroSection — Landing page hero with headline, CTAs, and animated canvas demo.
 * Split layout: copy on left, animation on right.
 */
import { strings } from '@/shared/localization/strings';
import { useHeroAnimation } from '../hooks/useHeroAnimation';
import { HeroAnimation } from './HeroAnimation';

/** Hero section with headline, sub-headline, CTAs, and animated canvas demo. */
export function HeroSection() {
    const { phase, reducedMotion } = useHeroAnimation();

    return (
        <section
            className="flex flex-col md:flex-row items-center w-full max-w-6xl"
            style={{
                marginLeft: 'auto',
                marginRight: 'auto',
                padding: 'var(--space-2xl) var(--space-xl)',
                gap: 'var(--space-2xl)',
                minHeight: '70vh',
            }}
        >
            {/* Copy */}
            <div
                className="flex flex-col items-start flex-1"
                style={{ gap: 'var(--space-lg)' }}
            >
                <h1
                    className="font-bold text-[var(--color-text-primary)]"
                    style={{
                        fontSize: 'clamp(1.75rem, 4vw, 2.75rem)',
                        lineHeight: 1.15,
                        letterSpacing: '-0.02em',
                    }}
                >
                    {strings.landing.hero.title}
                </h1>
                <p
                    className="text-[var(--color-text-secondary)]"
                    style={{
                        fontSize: 'var(--font-size-lg)',
                        lineHeight: 1.6,
                    }}
                >
                    {strings.landing.hero.subtitle}
                </p>
                <div className="flex items-center" style={{ gap: 'var(--space-md)' }}>
                    <a
                        href="/login"
                        className="inline-flex items-center justify-center no-underline rounded-lg font-medium transition-colors duration-150"
                        style={{
                            color: 'var(--color-text-on-primary)',
                            padding: 'var(--space-md) var(--space-xl)',
                            fontSize: 'var(--font-size-base)',
                            background: 'var(--color-primary)',
                        }}
                    >
                        {strings.landing.hero.ctaPrimary}
                    </a>
                    <a
                        href="#features"
                        className="inline-flex items-center text-[var(--color-text-secondary)] no-underline hover:text-[var(--color-text-primary)] transition-colors duration-150"
                        style={{ fontSize: 'var(--font-size-base)' }}
                    >
                        {strings.landing.hero.ctaSecondary}
                    </a>
                </div>
            </div>

            {/* Animated canvas demo */}
            <div className="flex-1 flex justify-center">
                <HeroAnimation phase={phase} reducedMotion={reducedMotion} />
            </div>
        </section>
    );
}
