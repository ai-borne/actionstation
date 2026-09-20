/**
 * GoogleDataSection — what Google user data ActionStation accesses and how it is handled.
 * Written to satisfy Google's OAuth verification (data accessed, purpose, storage, revocation,
 * Limited Use statement). Keep it in step with calendarAuth.ts / calendarEvents.ts.
 */
import { PrivacySection } from './PrivacySection';

const LINK_CLASS = 'underline text-[var(--color-primary)]';
const P_STYLE = { marginBottom: 12 } as const;

interface ExternalLinkProps {
    readonly href: string;
    readonly children: React.ReactNode;
}

function ExternalLink({ href, children }: ExternalLinkProps) {
    return (
        <a href={href} className={LINK_CLASS} target="_blank" rel="noopener noreferrer">
            {children}
        </a>
    );
}

export function GoogleDataSection({ title }: { readonly title: string }) {
    return (
        <PrivacySection title={title}>
            <p style={P_STYLE}>
                Signing in with Google gives us only your name, email address and profile photo.
            </p>
            <p style={P_STYLE}>
                <strong>Google Calendar (optional).</strong> Only after you choose Connect Calendar do we ask Google
                for access to your calendar (the <code>calendar.events</code> scope). We use it solely to create,
                update, delete and list events on your primary calendar when you act on an idea card, so the card and
                the event stay in sync. We save the event id, title and time with that card in your workspace.
            </p>
            <p style={P_STYLE}>
                <strong>Storage.</strong> We keep an OAuth refresh token for your account in our database (Google Cloud
                Firestore). It is encrypted at rest by Google Cloud, is not readable by your browser and is used only by
                our server functions.
            </p>
            <p style={P_STYLE}>
                <strong>No other use.</strong> We do not send events read from your calendar to any AI model, do not
                share Google user data with third parties, do not use Google user data for advertising, and do not let
                people read it except with your consent, for security, or to comply with the law.
            </p>
            <p style={P_STYLE}>
                <strong>Revoking access.</strong> Disconnecting Calendar in ActionStation revokes our access at Google
                and deletes the stored token; deleting your account also revokes it. You can also remove access at any
                time in your{' '}
                <ExternalLink href="https://myaccount.google.com/permissions">Google Account permissions</ExternalLink>.
            </p>
            <p>
                ActionStation&apos;s use and transfer of information received from Google APIs adheres to the{' '}
                <ExternalLink href="https://developers.google.com/terms/api-services-user-data-policy">
                    Google API Services User Data Policy
                </ExternalLink>
                , including the Limited Use requirements.
            </p>
        </PrivacySection>
    );
}
