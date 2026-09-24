/**
 * RefundPolicy — public Refund & Cancellation page at /refund.
 * Numbers come from pricing.ts so this page can never disagree with Terms or the checkout.
 */
import { LegalPage } from './LegalPage';
import { LegalSection } from './LegalSection';
import { strings } from '@/shared/localization/strings';
import { CONTACT_EMAIL } from '@/config/contact';
import { PRO_ANNUAL_PRICE_LABEL, REFUND_WINDOW_DAYS } from '@/features/subscription/types/pricing';

export function RefundPolicy() {
    const s = strings.legal.refund;
    return (
        <LegalPage title={strings.legal.refundTitle}>
            <LegalSection title={s.planHeading}>
                <p>{s.plan(PRO_ANNUAL_PRICE_LABEL)}</p>
            </LegalSection>
            <LegalSection title={s.cancellationHeading}>
                <p>{s.cancellation}</p>
            </LegalSection>
            <LegalSection title={s.refundHeading}>
                <p>{s.refund(REFUND_WINDOW_DAYS)}</p>
            </LegalSection>
            <LegalSection title={s.howHeading}>
                <p>
                    {s.howPrefix}{' '}
                    <a className="text-[var(--color-primary)] underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
                    {s.howSuffix}
                </p>
            </LegalSection>
            <LegalSection title={s.timelineHeading}>
                <p>{s.timeline}</p>
            </LegalSection>
        </LegalPage>
    );
}
