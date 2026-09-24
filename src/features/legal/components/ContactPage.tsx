/**
 * ContactPage — public page at /contact. Details come from the contact SSOT.
 */
import { LegalPage } from './LegalPage';
import { LegalSection } from './LegalSection';
import { strings } from '@/shared/localization/strings';
import {
    CONTACT_EMAIL,
    CONTACT_PHONE_E164,
    CONTACT_PHONE_DISPLAY,
    CONTACT_ADDRESS_LINES,
    PAYMENT_PROCESSOR_BRAND,
} from '@/config/contact';

const LINK_CLASS = 'text-[var(--color-primary)] underline';

export function ContactPage() {
    const s = strings.legal;
    return (
        <LegalPage title={s.contactTitle}>
            <p className="text-[var(--color-text-secondary)]" style={{ marginBottom: 32 }}>
                {s.contactIntro(PAYMENT_PROCESSOR_BRAND)}
            </p>
            <LegalSection title={s.contactEmailHeading}>
                <a className={LINK_CLASS} href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </LegalSection>
            <LegalSection title={s.contactPhoneHeading}>
                <a className={LINK_CLASS} href={`tel:${CONTACT_PHONE_E164}`}>{CONTACT_PHONE_DISPLAY}</a>
            </LegalSection>
            <LegalSection title={s.contactAddressHeading}>
                <address style={{ fontStyle: 'normal' }}>
                    {CONTACT_ADDRESS_LINES.map((line) => (
                        <div key={line}>{line}</div>
                    ))}
                </address>
            </LegalSection>
            <LegalSection title={s.contactResponseHeading}>
                <p>{s.contactResponse}</p>
            </LegalSection>
        </LegalPage>
    );
}
