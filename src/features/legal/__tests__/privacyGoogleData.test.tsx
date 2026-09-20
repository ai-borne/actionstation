/**
 * Privacy Policy: Google user data disclosure (checklist A10b).
 * Google's OAuth verification requires the policy to say what Google data the app accesses, why,
 * how it is stored and how to revoke it, and to carry the Limited Use statement.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PrivacyPolicy } from '../components/PrivacyPolicy';

function googleSection(): HTMLElement {
    render(<PrivacyPolicy />);
    const heading = screen.getByRole('heading', { name: /Google Account and Calendar Data/i });
    return heading.closest('section') as HTMLElement;
}

describe('Privacy Policy: Google user data', () => {
    it('has its own section', () => {
        expect(googleSection()).toBeInTheDocument();
    });

    it('carries the Google API Services User Data Policy Limited Use statement with a link', () => {
        const section = googleSection();
        expect(section).toHaveTextContent(/adheres? to the Google API Services User Data Policy, including the Limited Use requirements/i);
        expect(within(section).getByRole('link', { name: /Google API Services User Data Policy/i }))
            .toHaveAttribute('href', 'https://developers.google.com/terms/api-services-user-data-policy');
    });

    it('says what is accessed, why, and that Calendar is opt-in', () => {
        const section = googleSection();
        expect(section).toHaveTextContent(/calendar\.events\.owned/);
        expect(section).toHaveTextContent(/calendars you own/i);
        expect(section).toHaveTextContent(/primary calendar/i);
        expect(section).toHaveTextContent(/only after you choose Connect Calendar/i);
    });

    it('states how it is stored and that no calendar data goes to AI models, ads or third parties', () => {
        const section = googleSection();
        expect(section).toHaveTextContent(/refresh token/i);
        expect(section).toHaveTextContent(/not readable by your browser/i);
        expect(section).toHaveTextContent(/do not send events read from your calendar to any AI model/i);
        expect(section).toHaveTextContent(/do not use Google user data for advertising/i);
    });

    it('explains revocation (account deletion, expired session) and the Google Account route, without promising a control that does not exist', () => {
        const section = googleSection();
        expect(section).toHaveTextContent(/Deleting your account revokes our access at Google/i);
        expect(section).toHaveTextContent(/session (has )?expire/i);
        expect(section).not.toHaveTextContent(/Disconnecting Calendar in ActionStation/i);
        expect(within(section).getByRole('link', { name: /Google Account permissions/i }))
            .toHaveAttribute('href', 'https://myaccount.google.com/permissions');
    });
});
