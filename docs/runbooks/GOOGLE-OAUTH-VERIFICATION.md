# Google OAuth verification (Calendar scope) — plan

Checklist item: A10(b). Status: **plan only, nothing submitted.** Owner of the Google Cloud project submits it (`(You)`).

## Why

After A10(a), sign-in requests only Firebase's default scopes (profile, email), which need no verification. The opt-in
**Connect Calendar** flow still requests `https://www.googleapis.com/auth/calendar.events`, a **sensitive** scope. While the
consent screen is unverified:

- users who click Connect Calendar see "Google hasn't verified this app" and must click Advanced → Go to app;
- the app is capped at **100 users** who have granted a sensitive scope (lifetime, per project);
- if the publishing status is **Testing** (not "In production"), Google expires refresh tokens after **7 days**, which
  silently breaks the server-side calendar sync. Check this first (step 1).

Calendar is a sensitive scope, not a *restricted* one, so it needs Google's app verification but not the annual paid
third-party security assessment (CASA). Confirm the scope's category in the console when you add it.

## What the app actually does with the scope (use this for the justification)

Server-side only (`functions/src/calendarAuth.ts`, `calendarEvents.ts`); no token reaches the browser:

| Action | Calendar API call | User-visible purpose |
|--------|-------------------|----------------------|
| Create | `POST /calendars/primary/events` | Idea card with a date becomes a calendar event |
| Update | `PUT /calendars/primary/events/{id}` | Event follows edits of the card |
| Delete | `DELETE /calendars/primary/events/{id}` | Removing the card removes its event |
| List | `GET /calendars/primary/events` | Show upcoming events next to the canvas |

Only `primary` is touched. No other Google API and no other scope is used.

## Gaps to close before submitting

1. **Privacy Policy has no Google "Limited Use" statement.** `PrivacyContent.tsx` lists Google Calendar in one line. Google requires
   the policy to state that use of information received from Google APIs adheres to the
   [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the
   Limited Use requirements, and to describe what calendar data is accessed, why, how it is stored and how to revoke.
   Same file the D2 legal review covers: add it there, in `legalStrings.ts`/`PrivacyContent.tsx` per the hardcoding rules.
2. **Say what we store.** `exchangeCalendarCode` keeps the refresh token in Firestore. Before telling Google how it is
   protected, verify the storage path, the rules that guard it and whether it is encrypted beyond Firestore's default
   at-rest encryption (the older `docs/OAUTH_MIGRATION_GUIDE.md` says "encrypted"; the function code does not show explicit
   encryption). Fix the code or the wording, whichever is wrong.
3. **Revocation.** `disconnectCalendar` removes the stored token; confirm it also revokes the token at Google
   (`oauth2.googleapis.com/revoke`) and that account deletion (`onUserDeleted`) does the same. State it in the policy.
4. **Support and privacy mailboxes (D1)** must exist: the consent screen needs a support email, and Google may write to the
   developer contact addresses.
5. **Domain ownership.** Add `actionstation.in` as an authorized domain and verify it in Google Search Console with the same
   account that owns the project. The homepage and privacy-policy URLs on the consent screen must be on that domain
   (`https://www.actionstation.in/`, `https://www.actionstation.in/privacy`) and publicly reachable without login.
6. **A8:** the OAuth client is deleted by Google if unused after 2026-10-13. One real sign-in before then.

## Steps (console, yours)

1. Google Auth Platform → Branding/Audience: note the **publishing status** (Testing vs In production) and user type
   (External). Move to **In production** only when steps 2–5 are ready; doing so with an unverified sensitive scope keeps the
   warning screen and the 100-user cap but ends the 7-day token expiry.
2. Branding: app name, logo, home page, privacy policy, terms, authorized domain, developer contact.
3. Data Access: the only scope is `calendar.events`. Remove anything else.
4. Prepare the **scope justification** (text below) and a **demo video** (unlisted YouTube, English, ~2–3 min):
   sign in → open Connect Calendar → show the consent screen with the browser address bar and the OAuth client id visible →
   grant → create an idea card with a date → show the event in Google Calendar → edit → delete → Disconnect.
5. Submit for verification; answer reviewer emails within the window they give (they close inactive requests).
6. After approval: confirm the warning is gone with a fresh throwaway account, then tick A10(b).

### Scope justification (draft)

> ActionStation is a personal knowledge-capture canvas. When a user attaches a date to an idea, they can choose to sync it to
> their Google Calendar. We use `calendar.events` only to create, update, delete and list events on the user's primary
> calendar on their explicit action, so that ideas with dates appear in the calendar they already use and stay in sync.
> We do not read other calendars, share data, use it for advertising or train models on it. Tokens are stored server-side,
> the user can disconnect at any time (which deletes the token), and use of Google data follows the Google API Services
> User Data Policy including the Limited Use requirements.

## Option to evaluate (optional)

If Google offers a narrower, non-sensitive scope that fits (for example one limited to calendars the app itself creates, no
access to the user's primary calendar), a dedicated "ActionStation" calendar would avoid verification entirely. It changes
the product (events would not appear on the primary calendar), so it is a product decision, not a default. Check the current
scope list in Google's documentation before deciding.

## Definition of done

Verification status "Verified" on the consent screen; a fresh account can Connect Calendar with no "unverified" screen;
Privacy Policy carries the Limited Use statement (D2); checklist A10(b) ticked with the date and evidence.
