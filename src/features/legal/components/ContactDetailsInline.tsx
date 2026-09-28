/**
 * ContactDetailsInline — email as one paragraph's worth of text.
 * Used by Terms and Privacy so every legal page prints the same details from the contact SSOT.
 */
import { CONTACT_EMAIL } from '@/config/contact';

export function ContactDetailsInline() {
    return <strong>{CONTACT_EMAIL}</strong>;
}
