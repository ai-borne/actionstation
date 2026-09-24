/** Localized string constants for legal pages, consent banner, and data export UI. */
export const legalStrings = {
    // ── Shared legal page layout ──────────────────────────────────────────
    backButtonLabel: 'Back',
    backButtonAriaLabel: 'Go back to previous page',
    lastUpdated: 'Last updated:',
    lastUpdatedValue: 'September 24, 2026',

    // ── Page titles ───────────────────────────────────────────────────────
    termsTitle: 'Terms of Service',
    privacyTitle: 'Privacy Policy',
    refundTitle: 'Refund & Cancellation Policy',
    contactTitle: 'Contact Us',

    // ── Cookie / analytics consent banner ────────────────────────────────
    consentBannerAriaLabel: 'Cookie and analytics consent',
    consentBannerMessage: 'We use analytics to understand how ActionStation is used and improve the product. You can opt out at any time.',
    consentLearnMore: 'Learn more',
    consentLearnMoreAriaLabel: 'Learn more about our privacy policy',
    consentAccept: 'Accept',
    consentReject: 'Reject',
    consentAcceptAriaLabel: 'Accept analytics',
    consentRejectAriaLabel: 'Reject analytics',

    // ── Settings → Privacy tab ───────────────────────────────────────────
    privacySettingsTitle: 'Privacy',
    privacySettingsDescription:
        'ActionStation uses PostHog analytics to understand product usage. No personal content from your canvas is sent to analytics.',
    privacyAnalyticsEnabled: 'Analytics enabled',
    privacyAnalyticsDisabled: 'Analytics disabled',
    privacyEnableAnalytics: 'Enable analytics',
    privacyDisableAnalytics: 'Disable analytics',

    // ── Contact page ──────────────────────────────────────────────────────
    contactIntro: (brand: string) =>
        `ActionStation is built and operated by ${brand}. Reach us any time using the details below.`,
    contactEmailHeading: 'Email',
    contactPhoneHeading: 'Phone',
    contactAddressHeading: 'Office address',
    contactResponseHeading: 'Response time',
    contactResponse: 'We reply to support, billing and privacy requests within 2 business days.',

    // ── Refund & Cancellation page ────────────────────────────────────────
    refund: {
        planHeading: 'Our plans',
        plan: (price: string) =>
            `ActionStation has a Free plan and a Pro plan. Pro is a one-time annual purchase of ${price} per year, shown in Indian rupees (INR) before you pay. It does not renew automatically.`,
        cancellationHeading: 'Cancellation',
        cancellation:
            'Because Pro does not renew, there is nothing to cancel. Your plan stays active until it expires and you are never charged again unless you buy it again. You can delete your account at any time from Settings.',
        refundHeading: 'Refunds',
        refund: (days: number) =>
            `If Pro is not right for you, ask for a full refund within ${days} days of payment. After ${days} days, fees are not refundable except where the law requires.`,
        howHeading: 'How to request a refund',
        howPrefix: 'Email us from the address linked to your account at',
        howSuffix: ' with your payment ID if you have it. We confirm by email.',
        timelineHeading: 'When you get your money back',
        timeline:
            'Approved refunds are issued to the original payment method through Razorpay. Your bank usually credits it within 5 to 7 business days. Pro access ends once the refund is processed.',
    },

    // ── GDPR export payload warnings ─────────────────────────────────────
    gdprServerExportFailed:
        'Calendar and storage file inventory could not be retrieved from server. Other data is included below.',
} as const;

