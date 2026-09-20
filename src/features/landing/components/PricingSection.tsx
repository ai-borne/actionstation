/**
 * PricingSection — Two pricing cards (Free vs Pro) using SSOT tier limits.
 * All limit values imported from tierLimits.ts — never hardcoded.
 */
import { strings } from '@/shared/localization/strings';
import { FREE_TIER_LIMITS, PRO_TIER_LIMITS } from '@/features/subscription/types/tierLimits';
import { PricingCard } from './PricingCard';

const { labels, unlimited, generousLimits } = strings.landing.pricing;

function formatLimit(value: number): string {
    return value === Infinity ? unlimited : String(value);
}

function formatStorage(mb: number): string {
    return mb === Infinity ? unlimited : `${mb} MB`;
}

const FREE_FEATURES = [
    `${formatLimit(FREE_TIER_LIMITS.maxWorkspaces)} ${labels.workspaces}`,
    `${formatLimit(FREE_TIER_LIMITS.maxNodesPerWorkspace)} ${labels.nodesPerWorkspace}`,
    `${formatLimit(FREE_TIER_LIMITS.maxAiGenerationsPerDay)} ${labels.aiGenerationsPerDay}`,
    `${formatStorage(FREE_TIER_LIMITS.maxStorageMb)} ${labels.storage}`,
] as const;

const PRO_FEATURES = [
    `${formatLimit(PRO_TIER_LIMITS.maxWorkspaces)} ${labels.workspaces}`,
    `${formatLimit(PRO_TIER_LIMITS.maxNodesPerWorkspace)} ${labels.nodesPerWorkspace}`,
    `${formatLimit(PRO_TIER_LIMITS.maxAiGenerationsPerDay)} ${labels.aiGenerationsPerDay}`,
    `${formatStorage(PRO_TIER_LIMITS.maxStorageMb)} ${labels.storage}`,
    generousLimits,
] as const;

/** Two-card pricing comparison: Free vs Pro. */
export function PricingSection() {
    return (
        <section
            id="pricing"
            className="w-full max-w-4xl"
            style={{ padding: 'var(--space-2xl) var(--space-xl)', marginLeft: 'auto', marginRight: 'auto' }}
        >
            <h2
                className="font-bold text-center text-[var(--color-text-primary)]"
                style={{
                    fontSize: 'var(--font-size-xl)',
                    marginBottom: 'var(--space-sm)',
                }}
            >
                {strings.landing.pricing.sectionTitle}
            </h2>
            <p
                className="text-center text-[var(--color-text-secondary)]"
                style={{
                    fontSize: 'var(--font-size-base)',
                    marginBottom: 'var(--space-2xl)',
                }}
            >
                {strings.landing.pricing.sectionSubtitle}
            </p>
            <div
                className="grid grid-cols-1 md:grid-cols-2"
                style={{ gap: 'var(--space-lg)' }}
            >
                <PricingCard
                    planName={strings.landing.pricing.freePlanName}
                    price={strings.landing.pricing.freePrice}
                    features={FREE_FEATURES}
                    ctaLabel={strings.landing.pricing.freeCta}
                    ctaHref="/login"
                />
                <PricingCard
                    planName={strings.landing.pricing.proPlanName}
                    price={strings.landing.pricing.proPrice}
                    features={PRO_FEATURES}
                    ctaLabel={strings.landing.pricing.proCta}
                    ctaHref="/login"
                    badge={strings.landing.pricing.proBadge}
                    highlighted
                />
            </div>
        </section>
    );
}
