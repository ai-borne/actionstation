/**
 * ContactDetailsInline — email, phone and office address as one paragraph's worth of text.
 * Used by Terms and Privacy so every legal page prints the same details from the contact SSOT.
 */
import { CONTACT_EMAIL, CONTACT_PHONE_DISPLAY, CONTACT_ADDRESS_LINES } from '@/config/contact';

export function ContactDetailsInline() {
    return (
        <>
            <strong>{CONTACT_EMAIL}</strong>, phone <strong>{CONTACT_PHONE_DISPLAY}</strong>, or write to us at{' '}
            {CONTACT_ADDRESS_LINES.join(', ')}
        </>
    );
}
