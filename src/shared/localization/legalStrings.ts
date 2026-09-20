/** Localized string constants for legal pages, consent banner, and data export UI. */
export const legalStrings = {
    // ── Shared legal page layout ──────────────────────────────────────────
    backButtonLabel: 'Back',
    backButtonAriaLabel: 'Go back to previous page',
    lastUpdated: 'Last updated:',
    lastUpdatedValue: 'April 12, 2026',

    // ── Page titles ───────────────────────────────────────────────────────
    termsTitle: 'Terms of Service',
    privacyTitle: 'Privacy Policy',

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

    // ── GDPR export payload warnings ─────────────────────────────────────
    gdprServerExportFailed:
        'Calendar and storage file inventory could not be retrieved from server. Other data is included below.',
} as const;

