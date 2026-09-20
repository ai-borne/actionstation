/**
 * PrivacyContent — sections for the Privacy Policy page.
 * Prose content lives here; layout is provided by LegalPage.
 */
import { PrivacySection } from './PrivacySection';
import { GoogleDataSection } from './GoogleDataSection';

export function PrivacyContent() {
    return (
        <div>
            <PrivacySection title="1. Information We Collect">
                <p style={{ marginBottom: 12 }}>When you use ActionStation we collect:</p>
                <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
                    <li style={{ marginBottom: 6 }}><strong>Account data</strong> — your name, email address, and profile photo from Google OAuth</li>
                    <li style={{ marginBottom: 6 }}><strong>Workspace data</strong> — notes, nodes, edges, knowledge bank entries, and files you create</li>
                    <li style={{ marginBottom: 6 }}><strong>Usage data</strong> — feature interaction events collected via PostHog (only with your consent)</li>
                    <li style={{ marginBottom: 6 }}><strong>Error data</strong> — crash reports and performance metrics via Sentry</li>
                </ul>
                <p style={{ marginTop: 12 }}>We do not collect payment card details — all payments are processed by Stripe or Razorpay, who handle card data under their own PCI-DSS compliance.</p>
            </PrivacySection>

            <PrivacySection title="2. How We Use Your Information">
                <p style={{ marginBottom: 12 }}>We use your information to:</p>
                <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
                    <li style={{ marginBottom: 6 }}>Operate, maintain, and improve the ActionStation service</li>
                    <li style={{ marginBottom: 6 }}>Process AI requests through the Gemini API (your content is sent to Google for processing)</li>
                    <li style={{ marginBottom: 6 }}>Detect and prevent abuse, fraud, and security threats</li>
                    <li style={{ marginBottom: 6 }}>Send service-related communications (account, billing, security)</li>
                </ul>
                <p style={{ marginTop: 12 }}>We do not sell your data to third parties or use it for advertising.</p>
            </PrivacySection>

            <PrivacySection title="3. Third-Party Services">
                <p style={{ marginBottom: 12 }}>ActionStation integrates with the following third-party services:</p>
                <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
                    <li style={{ marginBottom: 6 }}><strong>Google Firebase</strong> — authentication, database (Firestore), file storage, and hosting</li>
                    <li style={{ marginBottom: 6 }}><strong>Google Gemini API</strong> — AI-powered text generation and synthesis</li>
                    <li style={{ marginBottom: 6 }}><strong>PostHog</strong> — product analytics (opt-in only; you control this via the cookie consent banner)</li>
                    <li style={{ marginBottom: 6 }}><strong>Sentry</strong> — error and performance monitoring (legitimate interest basis)</li>
                    <li style={{ marginBottom: 6 }}><strong>Stripe / Razorpay</strong> — payment processing for Pro subscriptions</li>
                    <li style={{ marginBottom: 6 }}><strong>Google Calendar</strong> — optional integration; only connected when you explicitly authorise it</li>
                </ul>
            </PrivacySection>

            <GoogleDataSection title="4. Google Account and Calendar Data" />

            <PrivacySection title="5. Data Storage and Security">
                <p>Your data is stored in Google Cloud infrastructure (Firestore and Firebase Storage) in the <strong>us-central1</strong> region. We apply encryption at rest and in transit, Firebase App Check to prevent unauthorised API access, and Firestore security rules that restrict data access to the owning account only.</p>
            </PrivacySection>

            <PrivacySection title="6. Data Retention and Deletion">
                <p>Your data is retained for as long as your account is active. When you delete your account, all associated data — workspaces, nodes, files, knowledge bank entries, and subscription records — is permanently deleted within 30 days. You can also export all your data before deletion from Settings → Account → Export All My Data.</p>
            </PrivacySection>

            <PrivacySection title="7. Your Rights">
                <p style={{ marginBottom: 12 }}>Under GDPR (if applicable to you) and other privacy law, you have the right to:</p>
                <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
                    <li style={{ marginBottom: 6 }}><strong>Access</strong> — request a copy of all data we hold about you (use Export All My Data)</li>
                    <li style={{ marginBottom: 6 }}><strong>Portability</strong> — download your data in JSON format at any time</li>
                    <li style={{ marginBottom: 6 }}><strong>Erasure</strong> — delete your account and all data from Settings</li>
                    <li style={{ marginBottom: 6 }}><strong>Objection</strong> — opt out of analytics via the cookie consent banner at any time</li>
                </ul>
            </PrivacySection>

            <PrivacySection title="8. Cookies and Analytics">
                <p>ActionStation uses local storage (not traditional cookies) for session management. PostHog analytics is only activated with your explicit consent. You can change your analytics preference at any time in Settings → Privacy. We honour the browser Do Not Track signal — if set, analytics are automatically disabled.</p>
            </PrivacySection>

            <PrivacySection title="9. Children&apos;s Privacy">
                <p>ActionStation is not directed at children under 13. We do not knowingly collect personal data from children. If you believe a child has provided us with data, please contact us and we will delete it promptly.</p>
            </PrivacySection>

            <PrivacySection title="10. Changes to This Policy">
                <p>We may update this Privacy Policy periodically. Material changes will be communicated via an in-app notice. Continued use after the effective date constitutes acceptance.</p>
            </PrivacySection>

            <PrivacySection title="11. Contact">
                <p>For privacy queries or data requests, contact us at <strong>privacy@actionstation.in</strong>.</p>
            </PrivacySection>
        </div>
    );
}
