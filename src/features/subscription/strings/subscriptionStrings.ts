/**
 * Subscription Strings — localized text for all subscription/billing UI
 */
import { PRO_ANNUAL_PRICE_LABEL, REFUND_WINDOW_DAYS } from '../types/pricing';

export const subscriptionStrings = {
    free: 'Free',
    pro: 'Pro',
    upgradeTitle: 'Upgrade to Pro',
    upgradeMessage: 'This feature requires a Pro subscription:',
    upgradeCta: 'Upgrade now',
    dismissUpgrade: 'Maybe later',
    currentPlan: 'Current plan',
    expiresAt: 'Expires',
    featureLocked: 'This feature requires a Pro subscription',
    upgradeAnnualCta: `Upgrade to Pro — ${PRO_ANNUAL_PRICE_LABEL}/year`,
    razorpayManageBilling:
        `Your Pro plan is a one-time annual purchase and does not renew. Not right for you? Email support@actionstation.in within ${REFUND_WINDOW_DAYS} days of payment for a full refund.`,
    legacyStripeBilling:
        'Your plan is billed through Stripe. For billing changes or refunds, email support@actionstation.in.',
    cancelAtPeriodEnd: 'Cancels at period end',
    active: 'Active',
    inactive: 'Inactive',
    pricingTitle: 'Choose your plan',
    pricingSubtitle: 'Unlock the full power of ActionStation',
    freeFeatures: 'Core canvas, AI assistant, workspace management',
    proFeatures: 'Offline access, background sync, document intelligence, priority support',
    proFeaturesAnnual: 'All monthly features + 2 months free, priority onboarding',
    perMonth: '/mo',
    perYear: '/yr',
    mostPopular: 'Most popular',
    currentPlanBadge: 'Current',
    subscriptionGroup: 'Subscription',
    upgradeLoading: 'Opening checkout...',
    limits: {
        workspaceLimit: 'You\u2019ve reached the maximum of 5 workspaces on the Free plan.',
        nodeLimit: 'This workspace has reached the 12-node limit on the Free plan.',
        aiDailyLimit: 'You\u2019ve used all 60 AI generations for today.',
        storageLimit: 'You\u2019ve reached the 50 MB storage limit on the Free plan.',
        storageReadFailed:
            'Storage usage could not be verified. Upload blocked until connection is restored.',
        upgradeForMore: 'Upgrade to Pro for higher limits.',
        workspaceUsage: (current: number, max: number) => `${current}/${max} workspaces`,
        nodeUsage: (current: number, max: number) => `${current}/${max} nodes`,
        aiUsage: (current: number, max: number) => `${current}/${max} AI generations today`,
        storageUsage: (currentMb: number, maxMb: number) =>
            `${currentMb.toFixed(1)}/${maxMb} MB used`,
    },
} as const;
