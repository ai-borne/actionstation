/**
 * TermsContent — sections for the Terms of Service page.
 * Prose content lives here; layout is provided by LegalPage.
 */
import { PRO_ANNUAL_PRICE_LABEL, REFUND_WINDOW_DAYS } from '@/features/subscription/types/pricing';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section style={{ marginBottom: 40 }}>
            <h2
                className="font-semibold text-[var(--color-text-primary)]"
                style={{ fontSize: 'var(--font-size-lg)', marginBottom: 12 }}
            >
                {title}
            </h2>
            <div className="text-[var(--color-text-secondary)]" style={{ fontSize: 'var(--font-size-base)', lineHeight: 1.8 }}>
                {children}
            </div>
        </section>
    );
}

export function TermsContent() {
    return (
        <div>
            <Section title="1. Acceptance of Terms">
                <p>By accessing or using ActionStation, you agree to be bound by these Terms of Service. If you do not agree, you may not use the service. These terms apply to all users, including visitors and registered account holders.</p>
            </Section>

            <Section title="2. Use of the Service">
                <p style={{ marginBottom: 12 }}>ActionStation is provided for personal and professional knowledge management. You agree not to use the service to:</p>
                <ul style={{ paddingLeft: 20, listStyleType: 'disc' }}>
                    <li style={{ marginBottom: 6 }}>Upload or distribute unlawful, harmful, or infringing content</li>
                    <li style={{ marginBottom: 6 }}>Attempt to gain unauthorized access to any part of the service</li>
                    <li style={{ marginBottom: 6 }}>Reverse-engineer or copy the service for competitive purposes</li>
                    <li style={{ marginBottom: 6 }}>Use automated tools to scrape or extract data at scale</li>
                </ul>
            </Section>

            <Section title="3. User Account">
                <p>You are responsible for maintaining the security of your account and all activity under it. ActionStation uses Google OAuth for authentication — we do not store your password. You must notify us immediately of any unauthorized account use.</p>
            </Section>

            <Section title="4. Data Ownership">
                <p>You own your content. ActionStation does not claim ownership over notes, workspaces, or any data you create. By using the service, you grant ActionStation a limited licence to process and store your content solely to operate and improve the service.</p>
            </Section>

            <Section title="5. Free and Pro Tiers">
                <p>ActionStation offers a free tier with usage limits and a Pro subscription with expanded limits. Pro is a one-time annual purchase ({PRO_ANNUAL_PRICE_LABEL} per year) that does not renew automatically and stays active until it expires. Pro is refunded in full if you ask within {REFUND_WINDOW_DAYS} days of payment; after that, fees are not refundable except where the law requires. Existing data is never deleted when you downgrade — only creation of new content is restricted.</p>
            </Section>

            <Section title="6. Limitation of Liability">
                <p>To the maximum extent permitted by applicable law, ActionStation and its operators are not liable for any indirect, incidental, special, or consequential damages arising from your use of the service. The service is provided &ldquo;as is&rdquo; without warranties of any kind.</p>
            </Section>

            <Section title="7. Termination">
                <p>You may delete your account at any time from the Account section in Settings. On deletion, all your content is permanently removed from our systems. If you had a paid plan, we keep a minimal payment record (payment ID, plan and dates) as long as accounting and tax rules require, and a Pro plan is not refunded automatically when you delete your account — ask for a refund first if you are within the {REFUND_WINDOW_DAYS}-day window. We reserve the right to suspend or terminate accounts that violate these terms, with notice where possible.</p>
            </Section>

            <Section title="8. Changes to These Terms">
                <p>We may update these Terms from time to time. Material changes will be announced in-app. Continued use after changes take effect constitutes acceptance of the new terms.</p>
            </Section>

            <Section title="9. Governing Law">
                <p>These Terms are governed by the laws of India. Any disputes shall be resolved in the courts of Bengaluru, Karnataka, India, unless applicable consumer protection law requires otherwise.</p>
            </Section>

            <Section title="10. Contact">
                <p>For questions about these Terms, contact us at <strong>support@actionstation.in</strong>.</p>
            </Section>
        </div>
    );
}
