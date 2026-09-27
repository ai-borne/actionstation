/**
 * Landing Page — Public marketing page at `/`.
 * Renders all landing sections in order.
 */
import { LandingNav } from './LandingNav';
import { HeroSection } from './HeroSection';
import { FeaturesSection } from './FeaturesSection';
import { HowItWorksSection } from './HowItWorksSection';
import { PricingSection } from './PricingSection';
import { FaqSection } from './FaqSection';
import { LandingFooter } from './LandingFooter';
import { LandingJsonLd } from './LandingJsonLd';

/** Public landing page rendered at `/` for all visitors. */
export function LandingPage() {
    return (
        <main
            className="flex flex-col min-h-screen w-full"
            style={{ background: 'var(--color-background)' }}
        >
            <LandingJsonLd />
            <LandingNav />
            <HeroSection />
            <FeaturesSection />
            <HowItWorksSection />
            <PricingSection />
            <FaqSection />
            <LandingFooter />
        </main>
    );
}
